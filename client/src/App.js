import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { InfoPanel } from './components/InfoPanel';
import { NewChatModal } from './components/NewChatModal';
import { ProfileModal } from './components/ProfileModal';
import { useWebSocket } from './hooks/useWebSocket';
import { CryptoEngine, clearTextCache } from './utils/crypto';
import { api } from './utils/api';
import { Push } from './utils/push';

function WsStatus({ status }) {
  const labels = {
    connecting: '⚡ Подключение к серверу...',
    connected: '✓ WebSocket подключён · E2EE активен',
    disconnected: '✕ Соединение потеряно · Переподключение...'
  };
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (status === 'connected') {
      const t = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(t);
    } else { setVisible(true); }
  }, [status]);
  return <div className={`ws-status ${visible ? 'show' : ''} ${status}`}>{labels[status]}</div>;
}

function Toast({ name, text, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className="toast">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="toast-name">{name}</div>
        <div className="toast-text">{text}</div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('cipher_token'));
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [wsMessages, setWsMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [showNewChat, setShowNewChat] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [infoOpen, setInfoOpen] = useState(true);
  const [toast, setToast] = useState(null);
  const activeConvRef = useRef(activeConv);
  const typingTimeoutsRef = useRef({});

  useEffect(() => { activeConvRef.current = activeConv; }, [activeConv]);

  useEffect(() => {
    (async () => {
      await CryptoEngine.init();
      if (token) {
        api.setToken(token);
        try {
          const me = await api.getMe();
          setUser(me);
          const pubKey = await CryptoEngine.getPublicKeyB64();
          if (pubKey && pubKey !== me.public_key) {
            const updated = await api.updateMe({ public_key: pubKey }).catch(() => null);
            if (updated) setUser(updated);
          }
          if (await Push.isSupported()) {
            const perm = await Push.getPermission();
            if (perm === 'granted') {
              Push.subscribe().catch(err => console.warn('[Push] auto-subscribe failed:', err));
            }
          }
        } catch (e) {
          api.setToken(null);
          setToken(null);
        }
      }
      setLoading(false);
    })();
  }, []); // run once

  const loadConversations = useCallback(async () => {
    if (!user) return;
    try { setConversations(await api.getConversations()); }
    catch (e) { console.error('Load convs:', e); }
  }, [user]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Decrypt last_message for previews on a best-effort basis
  useEffect(() => {
    if (!conversations.length || !user) return;
    (async () => {
      for (const c of conversations) {
        const lm = c.last_message;
        if (!lm || !lm.ciphertext || !lm.iv) continue;
        // Sender pubkey
        let senderKey = null;
        if (lm.sender_id === user.id) senderKey = user.public_key;
        else if (c.type === 'direct') senderKey = c.other_user?.public_key;
        else senderKey = c.members?.find(m => m.id === lm.sender_id)?.public_key;
        if (!senderKey) continue;
        const text = await CryptoEngine.decryptFromSender(lm.ciphertext, lm.iv, senderKey);
        if (text) {
          // cache & force re-render
          const { cacheText } = await import('./utils/crypto');
          cacheText(lm.id, text);
        }
      }
      // Force re-render of sidebar
      setConversations(prev => [...prev]);
    })();
  }, [conversations.length, user]);

  const handleWsMessage = useCallback((data) => {
    setWsMessages(prev => [...prev.slice(-49), data]);

    if (data.type === 'message:new') {
      setConversations(prev => prev.map(c => {
        if (c.id === data.message.conversation_id) {
          const unreadInc = (data.message.sender_id !== user?.id &&
                             activeConvRef.current?.id !== c.id) ? 1 : 0;
          return {
            ...c,
            last_message: {
              id: data.message.id,
              type: data.message.type,
              sender_id: data.message.sender_id,
              created_at: data.message.created_at,
              sender_name: data.message.sender_name,
              ciphertext: data.message.ciphertext,
              iv: data.message.iv
            },
            unread_count: (c.unread_count || 0) + unreadInc
          };
        }
        return c;
      }));

      if (data.message.sender_id !== user?.id && activeConvRef.current?.id !== data.message.conversation_id) {
        // Try decrypt for toast
        (async () => {
          const conv = conversations.find(x => x.id === data.message.conversation_id);
          let senderKey = null;
          if (conv?.type === 'direct') senderKey = conv.other_user?.public_key;
          else senderKey = conv?.members?.find(m => m.id === data.message.sender_id)?.public_key;
          let text = '🔐 Новое сообщение';
          if (senderKey && data.message.ciphertext && data.message.iv) {
            const decrypted = await CryptoEngine.decryptFromSender(
              data.message.ciphertext, data.message.iv, senderKey
            );
            if (decrypted) text = decrypted;
          }
          setToast({ name: data.message.sender_name, text });
        })();
      }
    }

    if (data.type === 'typing:start') {
      setTypingUsers(prev => {
        const existing = prev[data.conversation_id] || [];
        if (existing.includes(data.display_name)) return prev;
        return { ...prev, [data.conversation_id]: [...existing, data.display_name] };
      });
      const key = `${data.conversation_id}:${data.user_id}`;
      clearTimeout(typingTimeoutsRef.current[key]);
      typingTimeoutsRef.current[key] = setTimeout(() => {
        setTypingUsers(prev => ({
          ...prev,
          [data.conversation_id]: (prev[data.conversation_id] || []).filter(n => n !== data.display_name)
        }));
      }, 4000);
    }

    if (data.type === 'typing:stop') {
      setTypingUsers(prev => prev[data.conversation_id]
        ? { ...prev, [data.conversation_id]: [] } : prev);
    }

    if (data.type === 'presence') {
      setConversations(prev => prev.map(c => {
        if (c.other_user?.id === data.user_id) {
          return { ...c, other_user: { ...c.other_user, online: data.online, last_seen: data.last_seen } };
        }
        return c;
      }));
      setActiveConv(prev => {
        if (prev?.other_user?.id === data.user_id) {
          return { ...prev, other_user: { ...prev.other_user, online: data.online, last_seen: data.last_seen } };
        }
        return prev;
      });
    }

    if (data.type === 'connected') loadConversations();
  }, [user, loadConversations, conversations]);

  const { status: wsStatus, send: sendWs } = useWebSocket(token, handleWsMessage);

  const handleAuth = (newUser, newToken) => {
    setUser(newUser);
    setToken(newToken);
  };

  const handleLogout = async () => {
    if (!window.confirm('Выйти из аккаунта?')) return;
    await Push.unsubscribe().catch(() => {});
    clearTextCache();
    api.setToken(null);
    setToken(null);
    setUser(null);
    setActiveConv(null);
    setConversations([]);
  };

  const handleSelectConv = (conv) => {
    setActiveConv(conv);
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, unread_count: 0 } : c));
  };

  const handleNewChatCreated = (conv) => {
    setConversations(prev => prev.find(c => c.id === conv.id) ? prev : [conv, ...prev]);
    setActiveConv(conv);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text2)' }}>
        Загрузка...
      </div>
    );
  }

  if (!user) return <AuthScreen onAuth={handleAuth} />;

  return (
    <div className="app">
      <WsStatus status={wsStatus} />
      <Sidebar
        conversations={conversations}
        activeConvId={activeConv?.id}
        onSelectConv={handleSelectConv}
        currentUser={user}
        onLogout={handleLogout}
        onNewChat={() => setShowNewChat(true)}
        onProfile={() => setShowProfile(true)}
      />
      <ChatView
        conversation={activeConv}
        currentUser={user}
        wsMessages={wsMessages}
        sendWs={sendWs}
        typingUsers={typingUsers}
        onToggleInfo={() => setInfoOpen(!infoOpen)}
      />
      {activeConv && <InfoPanel conversation={activeConv} open={infoOpen} />}
      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} onCreated={handleNewChatCreated} />}
      {showProfile && <ProfileModal user={user} onClose={() => setShowProfile(false)} onUpdated={setUser} />}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}
