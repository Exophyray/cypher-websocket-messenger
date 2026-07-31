import React, { useState } from 'react';
import { Avatar } from './Avatar';
import { formatTime, formatDate, getCachedText } from '../utils/crypto';

export function Sidebar({ conversations, activeConvId, onSelectConv, currentUser, onLogout, onNewChat, onProfile }) {
  const [search, setSearch] = useState('');

  const formatConvTime = (ts) => {
    if (!ts) return '';
    const d = new Date(Number(ts));
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return formatTime(Number(ts));
    return formatDate(Number(ts));
  };

  const filtered = conversations.filter(c => {
    const name = c.type === 'direct' ? (c.other_user?.display_name || '') : (c.name || '');
    return name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <button className="icon-btn" onClick={onProfile} title="Профиль">
          <Avatar user={currentUser} size="sm" />
        </button>
        <div className="logo">Cipher</div>
        <div className="e2e-tag">E2EE</div>
        <button className="icon-btn" onClick={onNewChat} title="Новый чат">✎</button>
        <button className="icon-btn" onClick={onLogout} title="Выйти">⏻</button>
      </div>

      <div className="search-box">
        <span className="icon">🔍</span>
        <input placeholder="Поиск чатов..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="chat-list">
        {filtered.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            {conversations.length === 0
              ? 'У вас пока нет чатов. Нажмите ✎ чтобы начать.'
              : 'Ничего не найдено'}
          </div>
        )}

        {filtered.map(conv => {
          const name = conv.type === 'direct' ? conv.other_user?.display_name : conv.name;
          // Try to show cached plaintext, else show type-based placeholder
          let preview = 'Нет сообщений';
          if (conv.last_message) {
            const cached = getCachedText(conv.last_message.id);
            if (cached) preview = cached;
            else if (conv.last_message.type === 'image') preview = '📷 Изображение';
            else if (conv.last_message.type === 'file') preview = '📎 Файл';
            else preview = '🔐 Зашифрованное сообщение';
          }
          const time = formatConvTime(conv.last_message?.created_at);
          const displayUser = conv.type === 'direct'
            ? conv.other_user
            : { display_name: name, avatar_color: conv.avatar_color };

          return (
            <div key={conv.id}
              className={`chat-item ${activeConvId === conv.id ? 'active' : ''}`}
              onClick={() => onSelectConv(conv)}>
              <Avatar user={displayUser} online={conv.type === 'direct' && conv.other_user?.online} />
              <div className="chat-info">
                <div className="chat-name">{name || 'Без названия'}</div>
                <div className="chat-preview">
                  {conv.last_message?.sender_name && conv.type === 'group' && (
                    <span>{conv.last_message.sender_name}: </span>
                  )}
                  {preview}
                </div>
              </div>
              <div className="chat-meta">
                <div className="chat-time">{time}</div>
                {conv.unread_count > 0 && <div className="badge">{conv.unread_count}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
