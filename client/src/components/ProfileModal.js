import React, { useState } from 'react';
import { Avatar } from './Avatar';
import { api } from '../utils/api';

const COLORS = ['purple', 'teal', 'pink', 'amber', 'blue', 'green', 'red', 'indigo'];

export function ProfileModal({ user, onClose, onUpdated }) {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [bio, setBio] = useState(user.bio || '');
  const [color, setColor] = useState(user.avatar_color || 'purple');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateMe({ display_name: displayName, bio, avatar_color: color });
      onUpdated(updated);
      onClose();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const previewUser = { ...user, display_name: displayName, avatar_color: color };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Профиль</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Avatar user={previewUser} size="lg" />
        </div>
        <div className="auth-form">
          <input className="input-field" placeholder="Имя"
            value={displayName} onChange={e => setDisplayName(e.target.value)} />
          <input className="input-field" placeholder="@username"
            value={user.username} disabled style={{ opacity: 0.6 }} />
          <input className="input-field" placeholder="О себе"
            value={bio} onChange={e => setBio(e.target.value)} maxLength={200} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
            {COLORS.map(c => (
              <button key={c} className={`avatar av-${c}`}
                style={{
                  width: 36, height: 36, cursor: 'pointer',
                  outline: c === color ? '2px solid white' : 'none', outlineOffset: 2
                }}
                onClick={() => setColor(c)} />
            ))}
          </div>
          <button className="auth-btn" onClick={save} disabled={saving}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}
