import React, { useState, useEffect } from 'react';
import { Avatar } from './Avatar';
import { api } from '../utils/api';

export function NewChatModal({ onClose, onCreated }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [mode, setMode] = useState('direct');
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try { setResults(await api.searchUsers(query)); }
      catch (e) { console.error(e); }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const handleDirectChat = async (user) => {
    setLoading(true);
    try { onCreated(await api.createDirectChat(user.id)); onClose(); }
    catch (e) { alert(e.message); }
    finally { setLoading(false); }
  };

  const toggleMember = (user) => {
    setSelectedMembers(prev =>
      prev.find(m => m.id === user.id) ? prev.filter(m => m.id !== user.id) : [...prev, user]
    );
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedMembers.length === 0) return;
    setLoading(true);
    try { onCreated(await api.createGroup(groupName, selectedMembers.map(m => m.id))); onClose(); }
    catch (e) { alert(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{mode === 'direct' ? 'Новый чат' : 'Новая группа'}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className="auth-btn"
            style={{ flex: 1, padding: '10px', marginTop: 0,
              background: mode === 'direct' ? 'linear-gradient(135deg, var(--accent), #5b4fcf)' : 'var(--surface2)',
              boxShadow: mode === 'direct' ? '0 4px 14px rgba(124,106,247,0.4)' : 'none' }}
            onClick={() => setMode('direct')}>👤 Личный</button>
          <button className="auth-btn"
            style={{ flex: 1, padding: '10px', marginTop: 0,
              background: mode === 'group' ? 'linear-gradient(135deg, var(--accent), #5b4fcf)' : 'var(--surface2)',
              boxShadow: mode === 'group' ? '0 4px 14px rgba(124,106,247,0.4)' : 'none' }}
            onClick={() => setMode('group')}>👥 Группа</button>
        </div>

        {mode === 'group' && (
          <input className="input-field" placeholder="Название группы"
            value={groupName} onChange={e => setGroupName(e.target.value)}
            style={{ marginBottom: 12 }} />
        )}

        <input className="input-field" placeholder="Найти пользователя (минимум 2 символа)..."
          value={query} onChange={e => setQuery(e.target.value)} autoFocus />

        {mode === 'group' && selectedMembers.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '12px 0' }}>
            {selectedMembers.map(m => (
              <div key={m.id} style={{
                background: 'var(--surface2)', border: '1px solid var(--accent)',
                borderRadius: 18, padding: '4px 12px', fontSize: 12,
                display: 'flex', alignItems: 'center', gap: 6
              }}>
                {m.display_name}
                <button onClick={() => toggleMember(m)} style={{ color: 'var(--text3)' }}>✕</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16, maxHeight: 300, overflowY: 'auto' }}>
          {results.map(user => {
            const isSelected = selectedMembers.find(m => m.id === user.id);
            return (
              <div key={user.id} className="user-result"
                onClick={() => mode === 'direct' ? handleDirectChat(user) : toggleMember(user)}
                style={{
                  background: isSelected ? 'var(--surface3)' : 'transparent',
                  border: isSelected ? '1px solid var(--accent)' : '1px solid transparent'
                }}>
                <Avatar user={user} online={user.online} />
                <div style={{ flex: 1 }}>
                  <div className="user-result-name">{user.display_name}</div>
                  <div className="user-result-handle">@{user.username}</div>
                </div>
                {mode === 'group' && isSelected && <span style={{ color: 'var(--accent)' }}>✓</span>}
              </div>
            );
          })}
        </div>

        {mode === 'group' && (
          <button className="auth-btn"
            disabled={loading || !groupName.trim() || selectedMembers.length === 0}
            onClick={handleCreateGroup} style={{ marginTop: 16 }}>
            Создать группу ({selectedMembers.length})
          </button>
        )}
      </div>
    </div>
  );
}
