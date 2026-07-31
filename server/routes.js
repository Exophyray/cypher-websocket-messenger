const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('./db');
const { signToken, authMiddleware } = require('./auth');
const push = require('./push');

const router = express.Router();
const SALT_ROUNDS = 12;
const AVATAR_COLORS = ['purple', 'teal', 'pink', 'amber', 'blue', 'green', 'red', 'indigo'];

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const blocked = /\.(exe|bat|cmd|sh|ps1|msi|com|scr)$/i;
    if (blocked.test(file.originalname)) return cb(new Error('File type not allowed'));
    cb(null, true);
  }
});

/* ─── Auth ─── */
router.post('/auth/register', async (req, res) => {
  try {
    const { username, display_name, password, public_key } = req.body;
    if (!username || !password || !display_name) return res.status(400).json({ error: 'username, display_name and password required' });
    if (username.length < 3 || username.length > 32) return res.status(400).json({ error: 'username must be 3–32 chars' });
    if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 chars' });

    const exists = await query('SELECT id FROM users WHERE username = $1', [username.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const id = uuidv4();
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    await query(`
      INSERT INTO users (id, username, display_name, password_hash, public_key, avatar_color, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [id, username.toLowerCase(), display_name, hash, public_key || null, color, Date.now()]);

    const token = signToken({ id, username: username.toLowerCase() });
    const { rows: [user] } = await query(
      'SELECT id, username, display_name, avatar_color, public_key, bio, created_at FROM users WHERE id = $1', [id]
    );
    res.json({ token, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    const { rows: [user] } = await query('SELECT * FROM users WHERE username = $1', [username.toLowerCase()]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken({ id: user.id, username: user.username });
    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── Users ─── */
router.get('/users/me', authMiddleware, async (req, res) => {
  const { rows: [user] } = await query(
    'SELECT id, username, display_name, avatar_color, public_key, bio, last_seen, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.patch('/users/me', authMiddleware, async (req, res) => {
  try {
    const { display_name, bio, public_key, avatar_color } = req.body;
    const fields = [];
    const values = [];
    let i = 1;
    if (display_name) { fields.push(`display_name = $${i++}`); values.push(display_name); }
    if (bio !== undefined) { fields.push(`bio = $${i++}`); values.push(bio); }
    if (public_key) { fields.push(`public_key = $${i++}`); values.push(public_key); }
    if (avatar_color) { fields.push(`avatar_color = $${i++}`); values.push(avatar_color); }

    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    values.push(req.user.id);

    await query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`, values);
    const { rows: [user] } = await query(
      'SELECT id, username, display_name, avatar_color, public_key, bio, last_seen FROM users WHERE id = $1', [req.user.id]
    );
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/users/search', authMiddleware, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);
  const { rows } = await query(`
    SELECT id, username, display_name, avatar_color, bio, online, last_seen, public_key
    FROM users
    WHERE (username ILIKE $1 OR display_name ILIKE $1) AND id != $2
    LIMIT 20
  `, [`%${q}%`, req.user.id]);
  res.json(rows);
});

router.get('/users/:id/public-key', authMiddleware, async (req, res) => {
  const { rows: [user] } = await query('SELECT id, username, display_name, public_key FROM users WHERE id = $1', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

/* ─── Conversations ─── */
router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const { rows: convs } = await query(`
      SELECT c.id, c.type, c.name, c.avatar_color, c.created_at
      FROM conversations c
      JOIN conversation_members cm ON cm.conversation_id = c.id
      WHERE cm.user_id = $1
      ORDER BY (SELECT MAX(created_at) FROM messages WHERE conversation_id = c.id) DESC NULLS LAST
    `, [req.user.id]);

    const result = [];
    for (const conv of convs) {
      // Last message metadata + envelope FOR THIS USER
      const { rows: [lastMsg] } = await query(`
        SELECT m.id, m.type, m.created_at, m.sender_id,
               u.display_name as sender_name,
               e.ciphertext, e.iv
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        LEFT JOIN message_envelopes e ON e.message_id = m.id AND e.recipient_id = $2
        WHERE m.conversation_id = $1 AND m.deleted = false
        ORDER BY m.created_at DESC LIMIT 1
      `, [conv.id, req.user.id]);

      const { rows: [unread] } = await query(`
        SELECT COUNT(*)::int as cnt FROM messages m
        WHERE m.conversation_id = $1 AND m.sender_id != $2 AND m.deleted = false
          AND NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.message_id = m.id AND r.user_id = $2)
      `, [conv.id, req.user.id]);

      let otherUser = null;
      if (conv.type === 'direct') {
        const { rows: [u] } = await query(`
          SELECT u.id, u.username, u.display_name, u.avatar_color, u.online, u.last_seen, u.public_key
          FROM users u JOIN conversation_members cm ON cm.user_id = u.id
          WHERE cm.conversation_id = $1 AND u.id != $2
        `, [conv.id, req.user.id]);
        otherUser = u || null;
      }
      result.push({ ...conv, last_message: lastMsg || null, unread_count: unread.cnt, other_user: otherUser });
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/conversations/direct', authMiddleware, async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    if (user_id === req.user.id) return res.status(400).json({ error: 'Cannot chat with yourself' });

    const { rows: [target] } = await query('SELECT id FROM users WHERE id = $1', [user_id]);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const { rows: [existing] } = await query(`
      SELECT c.id FROM conversations c
      JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = $1
      JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = $2
      WHERE c.type = 'direct'
    `, [req.user.id, user_id]);

    if (existing) {
      const conv = await buildConvResponse(existing.id, req.user.id);
      return res.json(conv);
    }

    const convId = uuidv4();
    const now = Date.now();
    await query(`INSERT INTO conversations (id, type, created_by, created_at) VALUES ($1, 'direct', $2, $3)`, [convId, req.user.id, now]);
    await query(`INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ($1, $2, $3)`, [convId, req.user.id, now]);
    await query(`INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ($1, $2, $3)`, [convId, user_id, now]);

    res.status(201).json(await buildConvResponse(convId, req.user.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/conversations/group', authMiddleware, async (req, res) => {
  try {
    const { name, member_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const convId = uuidv4();
    const now = Date.now();
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    await query(`INSERT INTO conversations (id, type, name, avatar_color, created_by, created_at) VALUES ($1, 'group', $2, $3, $4, $5)`, [convId, name, color, req.user.id, now]);
    await query(`INSERT INTO conversation_members (conversation_id, user_id, joined_at, is_admin) VALUES ($1, $2, $3, true)`, [convId, req.user.id, now]);

    const allMembers = [...new Set([...(member_ids || []), req.user.id])];
    for (const uid of allMembers) {
      if (uid !== req.user.id) {
        try {
          await query(`INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [convId, uid, now]);
        } catch(e) {}
      }
    }

    res.status(201).json(await buildConvResponse(convId, req.user.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function buildConvResponse(convId, userId) {
  const { rows: [conv] } = await query('SELECT * FROM conversations WHERE id = $1', [convId]);
  const { rows: [lastMsg] } = await query(`
    SELECT m.id, m.type, m.created_at, m.sender_id,
           u.display_name as sender_name,
           e.ciphertext, e.iv
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN message_envelopes e ON e.message_id = m.id AND e.recipient_id = $2
    WHERE m.conversation_id = $1 AND m.deleted = false
    ORDER BY m.created_at DESC LIMIT 1
  `, [convId, userId]);
  let otherUser = null;
  if (conv.type === 'direct') {
    const { rows: [u] } = await query(`
      SELECT u.id, u.username, u.display_name, u.avatar_color, u.online, u.last_seen, u.public_key
      FROM users u JOIN conversation_members cm ON cm.user_id = u.id
      WHERE cm.conversation_id = $1 AND u.id != $2
    `, [convId, userId]);
    otherUser = u || null;
  }
  const { rows: members } = await query(`
    SELECT u.id, u.username, u.display_name, u.avatar_color, u.online, u.public_key
    FROM users u JOIN conversation_members cm ON cm.user_id = u.id
    WHERE cm.conversation_id = $1
  `, [convId]);
  return { ...conv, last_message: lastMsg || null, unread_count: 0, other_user: otherUser, members };
}

/* ─── Messages: history. Each msg returned WITH the envelope for THIS user ─── */
router.get('/conversations/:id/messages', authMiddleware, async (req, res) => {
  try {
    const { rows: [member] } = await query('SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Access denied' });

    const { before, limit = 50 } = req.query;
    const lim = Math.min(Number(limit), 100);

    const sql = before
      ? `SELECT m.*, u.display_name as sender_name, u.avatar_color as sender_color, u.username as sender_username,
                e.ciphertext, e.iv
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         LEFT JOIN message_envelopes e ON e.message_id = m.id AND e.recipient_id = $4
         WHERE m.conversation_id = $1 AND m.created_at < $2 AND m.deleted = false
         ORDER BY m.created_at DESC LIMIT $3`
      : `SELECT m.*, u.display_name as sender_name, u.avatar_color as sender_color, u.username as sender_username,
                e.ciphertext, e.iv
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         LEFT JOIN message_envelopes e ON e.message_id = m.id AND e.recipient_id = $3
         WHERE m.conversation_id = $1 AND m.deleted = false
         ORDER BY m.created_at DESC LIMIT $2`;
    const args = before
      ? [req.params.id, Number(before), lim, req.user.id]
      : [req.params.id, lim, req.user.id];
    const { rows: messages } = await query(sql, args);
    messages.reverse();

    for (const m of messages) {
      if (m.sender_id !== req.user.id) {
        await query('INSERT INTO message_reads (message_id, user_id, read_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [m.id, req.user.id, Date.now()]);
      }
    }
    
    const result = [];
    for (const m of messages) {
      let replyTo = null;
      if (m.reply_to_id) {
        // For reply preview we don't decrypt — client will resolve from local cache.
        // We provide id only, plus sender_id for context.
        const { rows: [r] } = await query('SELECT id, sender_id FROM messages WHERE id = $1', [m.reply_to_id]);
        replyTo = r || null;
      }
      const { rows: readBy } = await query(`
        SELECT u.id, u.display_name FROM message_reads r
        JOIN users u ON u.id = r.user_id
        WHERE r.message_id = $1 AND r.user_id != $2
      `, [m.id, m.sender_id]);
      result.push({ ...m, reply_to: replyTo, read_by: readBy });
    }

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── File upload ─── */
router.post('/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const isImage = /^image\//.test(req.file.mimetype);
  res.json({
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    size: req.file.size,
    mime: req.file.mimetype,
    type: isImage ? 'image' : 'file'
  });
});

/* ─── Push ─── */
router.get('/push/public-key', (req, res) => {
  const key = push.getPublicKey();
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ key });
});

router.post('/push/subscribe', authMiddleware, async (req, res) => {
  try { await push.subscribe(req.user.id, req.body.subscription); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/push/unsubscribe', authMiddleware, async (req, res) => {
  try { await push.unsubscribe(req.user.id, req.body.endpoint); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
