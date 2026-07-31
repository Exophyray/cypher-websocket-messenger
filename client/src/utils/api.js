const API_BASE = process.env.REACT_APP_API_URL || '/api';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('cipher_token');
  }

  setToken(token) {
    this.token = token;
    if (token) localStorage.setItem('cipher_token', token);
    else localStorage.removeItem('cipher_token');
  }

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(`${API_BASE}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Network error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async uploadFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('file', file);
      xhr.open('POST', `${API_BASE}/upload`);
      if (this.token) xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
      xhr.upload.onprogress = e => {
        if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
        else reject(new Error(JSON.parse(xhr.responseText).error || `HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(form);
    });
  }

  // Auth
  register(d)  { return this.request('POST', '/auth/register', d); }
  login(d)    { return this.request('POST', '/auth/login', d); }

  // Users
  getMe()              { return this.request('GET', '/users/me'); }
  updateMe(d)          { return this.request('PATCH', '/users/me', d); }
  searchUsers(q)       { return this.request('GET', `/users/search?q=${encodeURIComponent(q)}`); }
  getUserPublicKey(id) { return this.request('GET', `/users/${id}/public-key`); }

  // Conversations
  getConversations()       { return this.request('GET', '/conversations'); }
  createDirectChat(uid)    { return this.request('POST', '/conversations/direct', { user_id: uid }); }
  createGroup(name, ids)   { return this.request('POST', '/conversations/group', { name, member_ids: ids }); }
  getMessages(cid, before) {
    const q = before ? `?before=${before}` : '';
    return this.request('GET', `/conversations/${cid}/messages${q}`);
  }

  // Push
  getPushKey()         { return this.request('GET', '/push/public-key'); }
  subscribePush(sub)   { return this.request('POST', '/push/subscribe', { subscription: sub }); }
  unsubscribePush(ep)  { return this.request('POST', '/push/unsubscribe', { endpoint: ep }); }
}

export const api = new ApiClient();
