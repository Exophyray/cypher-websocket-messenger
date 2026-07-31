import React, { useState } from 'react';
import { api } from '../utils/api';
import { CryptoEngine } from '../utils/crypto';

export function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await CryptoEngine.init();
      const publicKey = await CryptoEngine.getPublicKeyB64();
      let result;
      if (mode === 'register') {
        result = await api.register({ username, display_name: displayName, password, public_key: publicKey });
      } else {
        result = await api.login({ username, password });
        if (publicKey) {
          api.setToken(result.token);
          await api.updateMe({ public_key: publicKey }).catch(() => {});
        }
      }
      api.setToken(result.token);
      onAuth(result.user, result.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">Cipher</div>
        <div className="auth-subtitle">🔐 E2EE · WebSocket · Real-time</div>
        <form onSubmit={submit} className="auth-form">
          <input type="text" placeholder="Имя пользователя" value={username}
            onChange={e => setUsername(e.target.value)} className="input-field"
            required minLength={3} maxLength={32} autoComplete="username" />
          {mode === 'register' && (
            <input type="text" placeholder="Отображаемое имя" value={displayName}
              onChange={e => setDisplayName(e.target.value)} className="input-field" required />
          )}
          <input type="password" placeholder="Пароль" value={password}
            onChange={e => setPassword(e.target.value)} className="input-field"
            required minLength={6}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? 'Подождите...' : (mode === 'register' ? 'Создать аккаунт' : 'Войти')}
          </button>
        </form>
        <div className="auth-switch">
          {mode === 'register' ? 'Уже есть аккаунт?' : 'Нет аккаунта?'}
          <button onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }}>
            {mode === 'register' ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </div>
      </div>
    </div>
  );
}
