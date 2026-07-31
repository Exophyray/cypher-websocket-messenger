import React, { useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { Message } from './Message';
import { formatLastSeen, formatDate, CryptoEngine, cacheText, getCachedText } from '../utils/crypto';
import { api } from '../utils/api';

export function ChatView({ conversation, currentUser, wsMessages, sendWs, typingUsers, onToggleInfo }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimerRef = useRef(null);

  const isGroup = conversation?.type === 'group';
  const otherUser = conversation?.other_user;

  // Decrypt a message coming from the server
  const decryptMessage = async (m) => {
    // System / deleted / no-envelope messages — show as is
    if (m.deleted) return { ...m, content: 'Сообщение удалено' };
    if (!m.ciphertext || !m.iv) {
      return { ...m, content: '[🔒 нет данных для расшифровки]' };
    }
    // We need sender's public key
    const sender = conversation.members?.find(u => u.id === m.sender_id)
                || (m.sender_id === currentUser.id ? currentUser : null)
                || conversation.other_user;
    if (!sender?.public_key) {
      return { ...m, content: '[🔒 нет ключа отправителя]' };
    }
    const plain = await CryptoEngine.decryptFromSender(m.ciphertext, m.iv, sender.public_key);
    const content = plain ?? '[🔒 не удалось расшифровать]';
    cacheText(m.id, content);
    return { ...m, content };
  };

  // Resolve reply preview using cache
  const enrichReplyPreview = (m) => {
    if (!m.reply_to) return m;
    const cached = getCachedText(m.reply_to.id);
    return { ...m, reply_to: { ...m.reply_to, content: cached || '[зашифровано]' } };
  };

  useEffect(() => {
  if (!conversation) return;
  setLoading(true);
  (async () => {
    try {
      const msgs = await api.getMessages(conversation.id);
      const decrypted = [];
      for (const m of msgs) {
        const d = await decryptMessage(m);
        decrypted.push(enrichReplyPreview(d));
      }
      setMessages(decrypted);

      // Notify senders via WS that we read their messages
      const unreadIds = decrypted
        .filter(m => m.sender_id !== currentUser.id && !m.read_by?.find(r => r.id === currentUser.id))
        .map(m => m.id);
      if (unreadIds.length) {
        sendWs({
          type: 'message:read',
          conversation_id: conversation.id,
          message_ids: unreadIds
        });
      }
    } catch (err) {
      console.error('Load messages:', err);
    } finally {
      setLoading(false);
    }
  })();
  setReplyTo(null);
  // eslint-disable-next-line
  }, [conversation?.id]);

  // Handle incoming WS events
  useEffect(() => {
    if (!wsMessages || !conversation) return;
    const last = wsMessages[wsMessages.length - 1];
    if (!last) return;

    (async () => {
      if (last.type === 'message:new' && last.message.conversation_id === conversation.id) {
        const decrypted = enrichReplyPreview(await decryptMessage(last.message));
        setMessages(prev => {
          if (prev.find(m => m.id === decrypted.id)) return prev;
          if (last.temp_id) {
            const idx = prev.findIndex(m => m.id === last.temp_id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = decrypted;
              return next;
            }
          }
          return [...prev, decrypted];
        });
        if (decrypted.sender_id !== currentUser.id) {
          sendWs({ type: 'message:read', conversation_id: conversation.id, message_ids: [decrypted.id] });
        }
      }

      if (last.type === 'message:edited' && last.conversation_id === conversation.id) {
        const sender = messages.find(x => x.id === last.message_id)?.sender_id;
        const senderUser = conversation.members?.find(u => u.id === sender)
                        || (sender === currentUser.id ? currentUser : conversation.other_user);
        let content = '[🔒 ...]';
        if (last.ciphertext && last.iv && senderUser?.public_key) {
          const p = await CryptoEngine.decryptFromSender(last.ciphertext, last.iv, senderUser.public_key);
          if (p) { content = p; cacheText(last.message_id, content); }
        }
        setMessages(prev => prev.map(m =>
          m.id === last.message_id ? { ...m, content, edited: true } : m
        ));
      }

      if (last.type === 'message:deleted' && last.conversation_id === conversation.id) {
        setMessages(prev => prev.map(m =>
          m.id === last.message_id ? { ...m, deleted: true, content: 'Сообщение удалено' } : m
        ));
      }

      if (last.type === 'message:read' && last.conversation_id === conversation.id) {
        setMessages(prev => prev.map(m => {
          if (last.message_ids.includes(m.id)) {
            const readBy = m.read_by || [];
            if (!readBy.find(r => r.id === last.reader_id)) {
              return { ...m, read_by: [...readBy, { id: last.reader_id }] };
            }
          }
          return m;
        }));
      }
    })();
    // eslint-disable-next-line
  }, [wsMessages, conversation, currentUser, sendWs]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, typingUsers]);

  useEffect(() => {
    const close = () => setCtxMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const buildMembersList = async () => {
    // For direct chats, conversation.members may not be loaded — get both users
    if (isGroup && conversation.members) return conversation.members;
    if (!isGroup) {
      const list = [];
      if (currentUser.public_key) list.push({ id: currentUser.id, public_key: currentUser.public_key });
      if (otherUser?.public_key) list.push({ id: otherUser.id, public_key: otherUser.public_key });
      return list;
    }
    return conversation.members || [];
  };

  const sendMessageWithAttachment = async (attachment) => {
    if (!conversation) return;
    const content = input.trim() || (attachment?.type === 'image' ? '📷 Изображение' : (attachment ? '📎 Файл' : ''));
    if (!content) return;

    const tempId = `temp-${Date.now()}`;
    const tempMsg = {
      id: tempId, content,
      sender_id: currentUser.id,
      sender_name: currentUser.display_name,
      sender_color: currentUser.avatar_color,
      created_at: Date.now(),
      reply_to: replyTo ? { id: replyTo.id, content: replyTo.content, sender_id: replyTo.sender_id } : null,
      read_by: [], pending: true,
      type: attachment?.type || 'text',
      attachment_url: attachment?.url,
      attachment_name: attachment?.name,
      attachment_size: attachment?.size,
      attachment_mime: attachment?.mime
    };
    cacheText(tempId, content);
    setMessages(prev => [...prev, tempMsg]);
    setInput('');
    setReplyTo(null);

    // Encrypt for every member of the chat
    const members = await buildMembersList();
    const envelopes = await CryptoEngine.encryptForMembers(content, members);

    if (envelopes.length === 0) {
      // Fallback: at least encrypt for self if no other keys
      const me = { id: currentUser.id, public_key: currentUser.public_key };
      const selfEnv = await CryptoEngine.encryptForMembers(content, [me]);
      envelopes.push(...selfEnv);
    }

    sendWs({
      type: 'message:send',
      conversation_id: conversation.id,
      envelopes,
      reply_to_id: replyTo?.id,
      temp_id: tempId,
      message_type: attachment?.type || 'text',
      attachment_url: attachment?.url,
      attachment_name: attachment?.name,
      attachment_size: attachment?.size,
      attachment_mime: attachment?.mime
    });

    sendWs({ type: 'typing:stop', conversation_id: conversation.id });
  };

  const handleSend = () => {
    if (uploading) return;
    if (!input.trim()) return;
    sendMessageWithAttachment(null);
  };

  const handleFileSelect = async (file) => {
    if (!file || !conversation) return;
    if (file.size > 25 * 1024 * 1024) { alert('Файл слишком большой (макс 25 МБ)'); return; }
    setUploading({ name: file.name, progress: 0, mime: file.type });
    try {
      const result = await api.uploadFile(file, p => setUploading(prev => prev ? { ...prev, progress: p } : null));
      sendMessageWithAttachment(result);
    } catch (e) {
      alert(`Ошибка загрузки: ${e.message}`);
    } finally {
      setUploading(null);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else {
      sendWs({ type: 'typing:start', conversation_id: conversation.id });
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        sendWs({ type: 'typing:stop', conversation_id: conversation.id });
      }, 2000);
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const handleContextMenu = (e, msg) => setCtxMenu({ x: e.clientX, y: e.clientY, message: msg });

  const handleEdit = async () => {
    if (!ctxMenu) return;
    const newContent = prompt('Редактировать:', ctxMenu.message.content);
    if (newContent && newContent !== ctxMenu.message.content) {
      const members = await buildMembersList();
      const envelopes = await CryptoEngine.encryptForMembers(newContent, members);
      cacheText(ctxMenu.message.id, newContent);
      sendWs({ type: 'message:edit', message_id: ctxMenu.message.id, envelopes });
    }
    setCtxMenu(null);
  };

  const handleDelete = () => {
    if (!ctxMenu) return;
    if (window.confirm('Удалить сообщение?')) sendWs({ type: 'message:delete', message_id: ctxMenu.message.id });
    setCtxMenu(null);
  };

  const handleReply = () => {
    if (!ctxMenu) return;
    setReplyTo(ctxMenu.message);
    setCtxMenu(null);
    inputRef.current?.focus();
  };

  const handleCopy = () => {
    if (!ctxMenu) return;
    navigator.clipboard.writeText(ctxMenu.message.content).catch(() => {});
    setCtxMenu(null);
  };

  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setDragOver(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  if (!conversation) {
    return (
      <div className="chat-main">
        <div className="chat-bg" />
        <div className="empty-state">
          <div className="empty-state-icon">🔐</div>
          <div className="empty-state-title">Cipher Messenger</div>
          <div className="empty-state-sub">
            Выберите чат слева или создайте новый.
            Все сообщения защищены сквозным шифрованием.
          </div>
        </div>
      </div>
    );
  }

  const groupedMessages = [];
  let lastDate = null;
  let lastSenderId = null;
  messages.forEach((m, i) => {
    const dateStr = formatDate(m.created_at);
    if (dateStr !== lastDate) {
      groupedMessages.push({ type: 'divider', date: dateStr, key: `d-${i}` });
      lastDate = dateStr;
      lastSenderId = null;
    }
    const showAvatar = m.sender_id !== lastSenderId;
    groupedMessages.push({ type: 'message', message: m, showAvatar, key: m.id });
    lastSenderId = m.sender_id;
  });

  const headerName = isGroup ? conversation.name : otherUser?.display_name || 'Без названия';
  const headerStatus = isGroup
    ? `${conversation.members?.length || 0} участников`
    : formatLastSeen(otherUser?.last_seen, otherUser?.online);
  const isOnline = !isGroup && otherUser?.online;
  const typingInThisChat = typingUsers[conversation.id] || [];

  return (
    <div className="chat-main"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}>
      <div className="chat-bg" />

      {dragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-text">📎<br />Отпустите файл</div>
        </div>
      )}

      <div className="chat-header">
        <Avatar user={isGroup ? { display_name: conversation.name, avatar_color: conversation.avatar_color } : otherUser}
          online={isOnline} />
        <div className="chat-header-info">
          <div className="chat-header-name">
            {headerName}
            <span className="e2e-badge-small">🔐 E2E</span>
          </div>
          <div className={`chat-header-status ${isOnline ? '' : 'offline'}`}>
            {isOnline && <span className="status-dot" />}
            {headerStatus}
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-btn" title="Информация" onClick={onToggleInfo}>ℹ️</button>
        </div>
      </div>

      <div className="messages-area">
        {loading && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text3)', fontSize: 13 }}>
            Расшифровка истории...
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="empty-state" style={{ flex: 1 }}>
            <div className="empty-state-icon">💬</div>
            <div className="empty-state-title">Начните разговор</div>
            <div className="empty-state-sub">
              Сообщения защищены сквозным шифрованием<br />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                ECDH P-256 · AES-256-GCM
              </span>
            </div>
          </div>
        )}

        {groupedMessages.map(item => {
          if (item.type === 'divider') {
            return (<div key={item.key} className="date-divider"><span>{item.date}</span></div>);
          }
          return (
            <Message
              key={item.key}
              message={item.message}
              isOutgoing={item.message.sender_id === currentUser.id}
              showAvatar={item.showAvatar}
              isGroupChat={isGroup}
              onContextMenu={handleContextMenu}
              onImageClick={setLightboxUrl}
            />
          );
        })}

        {typingInThisChat.length > 0 && (
          <div className="typing-row">
            <div className="typing-dots">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>
              {typingInThisChat.join(', ')} печатает...
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        {replyTo && (
          <div className="reply-bar">
            <div className="reply-bar-text">
              <strong>↩ Ответ на сообщение</strong>
              {(replyTo.content || '').slice(0, 100)}
            </div>
            <button className="modal-close" onClick={() => setReplyTo(null)}>✕</button>
          </div>
        )}

        {uploading && (
          <div className="upload-preview">
            <div className="upload-preview-thumb">📎</div>
            <div className="upload-preview-info">
              <div className="upload-preview-name">{uploading.name}</div>
              <div className="upload-preview-meta">{uploading.progress}%</div>
              <div className="upload-progress">
                <div className="upload-progress-bar" style={{ width: `${uploading.progress}%` }} />
              </div>
            </div>
          </div>
        )}

        <div className="input-row">
          <input ref={fileInputRef} type="file" style={{ display: 'none' }}
            onChange={e => { handleFileSelect(e.target.files?.[0]); e.target.value = ''; }} />
          <button className="icon-btn" onClick={() => fileInputRef.current?.click()}
            title="Прикрепить файл" style={{ width: 42, height: 42 }}>📎</button>
          <div className="input-wrapper">
            <textarea ref={inputRef} rows={1} placeholder="Напишите сообщение..."
              value={input} onChange={handleInputChange} onKeyDown={handleKeyDown} />
          </div>
          <button className="send-btn" onClick={handleSend} disabled={!input.trim() || uploading}>➤</button>
        </div>

        <div className="encryption-footer">
          🔐 ECDH P-256 + AES-256-GCM · сервер видит только шифротекст
        </div>
      </div>

      {ctxMenu && (
        <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={e => e.stopPropagation()}>
          <div className="ctx-item" onClick={handleReply}>↩️ Ответить</div>
          <div className="ctx-item" onClick={handleCopy}>📋 Копировать</div>
          {ctxMenu.message.sender_id === currentUser.id && !ctxMenu.message.deleted && (
            <>
              <div className="ctx-item" onClick={handleEdit}>✏️ Редактировать</div>
              <div className="ctx-item danger" onClick={handleDelete}>🗑️ Удалить</div>
            </>
          )}
        </div>
      )}

      {lightboxUrl && (
        <div className="lightbox" onClick={() => setLightboxUrl(null)}>
          <button className="lightbox-close">✕</button>
          <img src={lightboxUrl} alt="" />
        </div>
      )}
    </div>
  );
}
