const { wsAuth } = require('./auth');
const { query } = require('./db');
const push = require('./push');
const { v4: uuidv4 } = require('uuid');

const clients = new Map();

function broadcast(userIds, eventBuilder) {
  // eventBuilder может быть либо объектом, либо функцией (userId) => object
  // для случаев, когда payload разный для каждого получателя (envelope)
  for (const uid of userIds) {
    const sockets = clients.get(uid);
    if (sockets) {
      const event = typeof eventBuilder === 'function' ? eventBuilder(uid) : eventBuilder;
      if (!event) continue;
      const payload = JSON.stringify(event);
      for (const ws of sockets) {
        if (ws.readyState === 1) ws.send(payload);
      }
    }
  }
}

async function getConvMembers(convId) {
  const { rows } = await query('SELECT user_id FROM conversation_members WHERE conversation_id = $1', [convId]);
  return rows.map(r => r.user_id);
}

function isUserOnline(userId) {
  const set = clients.get(userId);
  return set && set.size > 0;
}

function setupWebSocket(wss) {
  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const user = wsAuth(token);

    if (!user) { ws.close(4001, 'Unauthorized'); return; }
    const userId = user.id;

    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(ws);

    try {
      await query('UPDATE users SET online = true, last_seen = $1 WHERE id = $2', [Date.now(), userId]);
      await broadcastPresence(userId, true);
    } catch (e) { console.error('[WS] Presence update failed:', e.message); }

    console.log(`[WS] User ${userId} connected (${clients.get(userId).size} connections)`);

    ws.on('message', async (raw) => {
      let data;
      try { data = JSON.parse(raw); } catch { return; }
      try { await handleMessage(ws, userId, data); }
      catch (e) { console.error('[WS] handleMessage error:', e.message); }
    });

    ws.on('close', async () => {
      const sockets = clients.get(userId);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          clients.delete(userId);
          try {
            await query('UPDATE users SET online = false, last_seen = $1 WHERE id = $2', [Date.now(), userId]);
            await broadcastPresence(userId, false);
          } catch (e) {}
        }
      }
      console.log(`[WS] User ${userId} disconnected`);
    });

    ws.on('error', (err) => console.error('[WS] Error:', err.message));
    ws.send(JSON.stringify({ type: 'connected', userId }));
  });
}

async function handleMessage(ws, userId, data) {
  switch (data.type) {

    case 'message:send': {
      /*
        Клиент отправляет envelopes: [{recipient_id, ciphertext, iv}, ...]
        для каждого участника чата (включая себя — чтобы видеть в истории).
        Сервер plaintext не видит.
      */
      const { conversation_id, envelopes, reply_to_id, temp_id,
              attachment_url, attachment_name, attachment_size, attachment_mime } = data;

      const ALLOWED = ['text', 'image', 'file', 'system'];
      const rawType = String(data.message_type || 'text').toLowerCase().trim();
      const type = ALLOWED.includes(rawType) ? rawType : 'text';

      if (!conversation_id || !Array.isArray(envelopes) || envelopes.length === 0) return;

      const { rows: [member] } = await query(
        'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
        [conversation_id, userId]
      );
      if (!member) return;

      const members = await getConvMembers(conversation_id);
      // Принимаем envelopes только для членов чата
      const validEnvelopes = envelopes.filter(e =>
        members.includes(e.recipient_id) && e.ciphertext && e.iv
      );
      if (!validEnvelopes.length) return;

      const id = uuidv4();
      const now = Date.now();

      await query(`
        INSERT INTO messages (id, conversation_id, sender_id, reply_to_id, type,
                              attachment_url, attachment_name, attachment_size, attachment_mime, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [id, conversation_id, userId, reply_to_id || null, type,
          attachment_url || null, attachment_name || null, attachment_size || null, attachment_mime || null, now]);

      // Сохраняем по копии шифротекста для каждого получателя
      for (const env of validEnvelopes) {
        await query(`
          INSERT INTO message_envelopes (message_id, recipient_id, ciphertext, iv)
          VALUES ($1, $2, $3, $4)
        `, [id, env.recipient_id, env.ciphertext, env.iv]);
      }

      const { rows: [meta] } = await query(`
        SELECT m.id, m.conversation_id, m.sender_id, m.reply_to_id, m.type,
               m.attachment_url, m.attachment_name, m.attachment_size, m.attachment_mime,
               m.edited, m.deleted, m.created_at,
               u.display_name as sender_name, u.avatar_color as sender_color, u.username as sender_username
        FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = $1
      `, [id]);

      let replyTo = null;
      if (reply_to_id) {
        const { rows: [r] } = await query('SELECT id, sender_id FROM messages WHERE id = $1', [reply_to_id]);
        replyTo = r || null;
      }

      // Каждому участнику шлём его envelope
      const envelopeByUser = {};
      for (const env of validEnvelopes) envelopeByUser[env.recipient_id] = env;

      broadcast(members, (uid) => {
        const env = envelopeByUser[uid];
        if (!env) return null;
        return {
          type: 'message:new',
          message: {
            ...meta,
            ciphertext: env.ciphertext,
            iv: env.iv,
            reply_to: replyTo,
            read_by: []
          },
          temp_id: uid === userId ? temp_id : undefined
        };
      });

      // Push offline members. Сервер plaintext не имеет — шлём generic body.
      const { rows: [convInfo] } = await query('SELECT type, name FROM conversations WHERE id = $1', [conversation_id]);
      const convName = convInfo.type === 'group' ? convInfo.name : meta.sender_name;
      const body = type === 'text' ? '🔐 Новое сообщение' : (type === 'image' ? '📷 Изображение' : '📎 Файл');
      for (const memberId of members) {
        if (memberId !== userId && !isUserOnline(memberId)) {
          push.sendToUser(memberId, {
            title: convName,
            body,
            conversation_id,
            sender: meta.sender_name
          }).catch(() => {});
        }
      }
      break;
    }

    case 'message:edit': {
      /*
        Редактирование = новые envelopes для всех получателей.
        Удаляем старые envelopes, добавляем новые.
      */
      const { message_id, envelopes } = data;
      const { rows: [msg] } = await query('SELECT * FROM messages WHERE id = $1 AND sender_id = $2', [message_id, userId]);
      if (!msg) return;
      if (!Array.isArray(envelopes) || envelopes.length === 0) return;

      const members = await getConvMembers(msg.conversation_id);
      const validEnvelopes = envelopes.filter(e => members.includes(e.recipient_id) && e.ciphertext && e.iv);
      if (!validEnvelopes.length) return;

      await query('DELETE FROM message_envelopes WHERE message_id = $1', [message_id]);
      for (const env of validEnvelopes) {
        await query(`
          INSERT INTO message_envelopes (message_id, recipient_id, ciphertext, iv)
          VALUES ($1, $2, $3, $4)
        `, [message_id, env.recipient_id, env.ciphertext, env.iv]);
      }
      await query('UPDATE messages SET edited = true WHERE id = $1', [message_id]);

      const envelopeByUser = {};
      for (const env of validEnvelopes) envelopeByUser[env.recipient_id] = env;

      broadcast(members, (uid) => {
        const env = envelopeByUser[uid];
        if (!env) return null;
        return {
          type: 'message:edited',
          message_id,
          conversation_id: msg.conversation_id,
          ciphertext: env.ciphertext,
          iv: env.iv
        };
      });
      break;
    }

    case 'message:delete': {
      const { message_id } = data;
      const { rows: [msg] } = await query('SELECT * FROM messages WHERE id = $1 AND sender_id = $2', [message_id, userId]);
      if (!msg) return;
      await query('UPDATE messages SET deleted = true WHERE id = $1', [message_id]);
      await query('DELETE FROM message_envelopes WHERE message_id = $1', [message_id]);
      const members = await getConvMembers(msg.conversation_id);
      broadcast(members, { type: 'message:deleted', message_id, conversation_id: msg.conversation_id });
      break;
    }

    case 'message:read': {
      const { conversation_id, message_ids } = data;
      if (!Array.isArray(message_ids)) return;
      for (const mid of message_ids) {
        await query('INSERT INTO message_reads (message_id, user_id, read_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [mid, userId, Date.now()]);
      }
      const members = await getConvMembers(conversation_id);
      broadcast(members.filter(m => m !== userId), {
        type: 'message:read', conversation_id, message_ids, reader_id: userId
      });
      break;
    }

    case 'typing:start': {
      const { conversation_id } = data;
      const members = await getConvMembers(conversation_id);
      const { rows: [u] } = await query('SELECT display_name FROM users WHERE id = $1', [userId]);
      broadcast(members.filter(m => m !== userId), {
        type: 'typing:start', conversation_id, user_id: userId, display_name: u?.display_name
      });
      break;
    }

    case 'typing:stop': {
      const { conversation_id } = data;
      const members = await getConvMembers(conversation_id);
      broadcast(members.filter(m => m !== userId), {
        type: 'typing:stop', conversation_id, user_id: userId
      });
      break;
    }

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      break;
  }
}

async function broadcastPresence(userId, online) {
  const { rows } = await query(`
    SELECT DISTINCT cm2.user_id FROM conversation_members cm1
    JOIN conversation_members cm2 ON cm2.conversation_id = cm1.conversation_id
    WHERE cm1.user_id = $1 AND cm2.user_id != $1
  `, [userId]);
  const contactIds = rows.map(r => r.user_id);
  broadcast(contactIds, { type: 'presence', user_id: userId, online, last_seen: Date.now() });
}

module.exports = { setupWebSocket };
