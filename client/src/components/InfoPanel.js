import React, { useEffect, useState } from 'react';
import { Avatar } from './Avatar';
import { formatLastSeen } from '../utils/crypto';
import { Push } from '../utils/push';

export function InfoPanel({ conversation, open }) {
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);

  useEffect(() => {
    (async () => {
      const supported = await Push.isSupported();
      setPushSupported(supported);
      if (supported) setPushSubscribed(await Push.isSubscribed());
    })();
  }, []);

  if (!conversation) return null;
  const isGroup = conversation.type === 'group';
  const user = isGroup ? null : conversation.other_user;
  const displayUser = isGroup
    ? { display_name: conversation.name, avatar_color: conversation.avatar_color }
    : user;

  const pubKey = user?.public_key || '';
  const formattedKey = pubKey ? pubKey.match(/.{1,32}/g)?.join('\n') : 'Ключ не доступен';

  const togglePush = async () => {
    try {
      if (pushSubscribed) {
        await Push.unsubscribe();
        setPushSubscribed(false);
      } else {
        await Push.subscribe();
        setPushSubscribed(true);
      }
    } catch (e) {
      alert(`Push: ${e.message}`);
    }
  };

  return (
    <div className={`info-panel ${open ? '' : 'hidden'}`}>
      <div className="profile-section">
        <Avatar user={displayUser} size="lg" online={user?.online} />
        <div className="profile-name">{displayUser?.display_name}</div>
        <div className="profile-handle">
          {isGroup ? `${conversation.members?.length || 0} участников` : `@${user?.username}`}
        </div>
        <div style={{ fontSize: 12, color: user?.online ? 'var(--online)' : 'var(--text3)', marginTop: 6 }}>
          {user ? formatLastSeen(Number(user.last_seen), user.online) : 'групповой чат'}
        </div>
      </div>

      {!isGroup && user?.bio && (
        <div className="info-section">
          <div className="info-section-title">О себе</div>
          <div className="info-row">
            <div className="info-row-icon">📝</div>
            <div>{user.bio}</div>
          </div>
        </div>
      )}

      <div className="info-section">
        <div className="info-section-title">Шифрование</div>
        <div className="info-row">
          <div className="info-row-icon">🔐</div>
          <div style={{ fontSize: 12 }}>End-to-End активно<br />ECDH P-256 · AES-256-GCM</div>
        </div>
        {pubKey && (
          <>
            <div className="info-section-title" style={{ marginTop: 12 }}>Публичный ключ</div>
            <div className="key-display">{formattedKey?.slice(0, 200) || '—'}</div>
          </>
        )}
      </div>

      {pushSupported && (
        <div className="info-section">
          <div className="info-section-title">Уведомления</div>
          <button className={`push-toggle-btn ${pushSubscribed ? 'active' : ''}`} onClick={togglePush}>
            <span>{pushSubscribed ? '🔔 Push включены' : '🔕 Включить push'}</span>
            <span>{pushSubscribed ? '✓' : '→'}</span>
          </button>
        </div>
      )}

      {isGroup && conversation.members && (
        <div className="info-section">
          <div className="info-section-title">Участники</div>
          {conversation.members.map(m => (
            <div key={m.id} className="info-row" style={{ padding: '8px 0' }}>
              <Avatar user={m} size="sm" online={m.online} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                  {m.display_name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>@{m.username}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
