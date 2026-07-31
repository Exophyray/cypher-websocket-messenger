// True E2EE engine.
// - ECDH P-256 keypair per user, private key in localStorage
// - For each conversation member: derive shared AES-GCM key from (myPriv + theirPub)
// - To send: encrypt message N times (one envelope per member) with their shared key
// - To receive: server gives the envelope for current user; decrypt with that user's shared key

export const CryptoEngine = {
  keyPair: null,
  sharedKeys: new Map(), // publicKeyB64 -> CryptoKey (AES-GCM)

  async init() {
    const stored = localStorage.getItem('cipher_keypair');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const privateKey = await crypto.subtle.importKey('pkcs8', b64ToBuf(parsed.privateKey),
          { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
        const publicKey = await crypto.subtle.importKey('spki', b64ToBuf(parsed.publicKey),
          { name: 'ECDH', namedCurve: 'P-256' }, true, []);
        this.keyPair = { privateKey, publicKey };
        return this;
      } catch (e) { console.warn('[Crypto] Restore failed, generating new'); }
    }
    this.keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const pub  = await crypto.subtle.exportKey('spki', this.keyPair.publicKey);
    const priv = await crypto.subtle.exportKey('pkcs8', this.keyPair.privateKey);
    localStorage.setItem('cipher_keypair', JSON.stringify({
      publicKey: bufToB64(pub), privateKey: bufToB64(priv)
    }));
    return this;
  },

  async getPublicKeyB64() {
    if (!this.keyPair) return null;
    const raw = await crypto.subtle.exportKey('spki', this.keyPair.publicKey);
    return bufToB64(raw);
  },

  async deriveSharedKey(theirPublicKeyB64) {
    if (!theirPublicKeyB64) return null;
    if (this.sharedKeys.has(theirPublicKeyB64)) return this.sharedKeys.get(theirPublicKeyB64);
    try {
      const theirKey = await crypto.subtle.importKey('spki', b64ToBuf(theirPublicKeyB64),
        { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const sharedKey = await crypto.subtle.deriveKey({ name: 'ECDH', public: theirKey },
        this.keyPair.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt']);
      this.sharedKeys.set(theirPublicKeyB64, sharedKey);
      return sharedKey;
    } catch (e) { console.error('[Crypto] derive failed:', e); return null; }
  },

  async encryptWithKey(plaintext, sharedKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, encoded);
    return { ciphertext: bufToB64(cipher), iv: bufToB64(iv) };
  },

  async decryptWithKey(ciphertextB64, ivB64, sharedKey) {
    try {
      const iv = b64ToBuf(ivB64);
      const data = b64ToBuf(ciphertextB64);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, data);
      return new TextDecoder().decode(plain);
    } catch (e) {
      return null;
    }
  },

  // For sender: encrypt message for each member (including self)
  // members: [{id, public_key}, ...]
  async encryptForMembers(plaintext, members) {
    const envelopes = [];
    for (const m of members) {
      if (!m.public_key) continue;
      const sharedKey = await this.deriveSharedKey(m.public_key);
      if (!sharedKey) continue;
      const { ciphertext, iv } = await this.encryptWithKey(plaintext, sharedKey);
      envelopes.push({ recipient_id: m.id, ciphertext, iv });
    }
    return envelopes;
  },

  // For receiver: decrypt a message that was sent to me, using sender's public key
  async decryptFromSender(ciphertextB64, ivB64, senderPublicKey) {
    if (!ciphertextB64 || !ivB64 || !senderPublicKey) return null;
    const sharedKey = await this.deriveSharedKey(senderPublicKey);
    if (!sharedKey) return null;
    return this.decryptWithKey(ciphertextB64, ivB64, sharedKey);
  }
};

function bufToB64(b) { return btoa(String.fromCharCode(...new Uint8Array(b))); }
function b64ToBuf(s) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function formatTime(ts) {
  return new Date(Number(ts)).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(ts) {
  const d = new Date(Number(ts));
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Сегодня';
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function formatLastSeen(ts, online) {
  if (online) return 'в сети';
  if (!ts) return 'не в сети';
  const diff = Date.now() - Number(ts);
  if (diff < 60000) return 'только что';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} мин. назад`;
  if (diff < 86400000) return `сегодня в ${formatTime(ts)}`;
  return new Date(Number(ts)).toLocaleDateString('ru-RU');
}

export function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// Local cache for decrypted plaintext to power reply previews and list previews
// without re-decrypting on every render. Cleared on logout.
const plaintextCache = new Map();
export function cacheText(msgId, text) { plaintextCache.set(msgId, text); }
export function getCachedText(msgId) { return plaintextCache.get(msgId); }
export function clearTextCache() { plaintextCache.clear(); }
