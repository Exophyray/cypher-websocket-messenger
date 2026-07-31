const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  port:     process.env.PG_PORT     || 5432,
  database: process.env.PG_DATABASE || 'cipher',
  user:     process.env.PG_USER     || 'cipher',
  password: process.env.PG_PASSWORD || 'cipher_pwd',
  max: 20,
  idleTimeoutMillis: 30000
});

pool.on('error', (err) => console.error('[PG] Pool error:', err.message));

async function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function initSchema() {
  let lastErr;
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (e) {
      lastErr = e;
      console.log(`[PG] Waiting for database... (${i+1}/30)`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  if (lastErr) {
    try { await pool.query('SELECT 1'); } catch (e) { throw e; }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      display_name  TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      public_key    TEXT,
      avatar_color  TEXT DEFAULT 'purple',
      bio           TEXT DEFAULT '',
      last_seen     BIGINT DEFAULT 0,
      online        BOOLEAN DEFAULT false,
      created_at    BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL CHECK(type IN ('direct','group')),
      name         TEXT,
      avatar_color TEXT DEFAULT 'purple',
      created_by   TEXT REFERENCES users(id),
      created_at   BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
      user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
      joined_at       BIGINT NOT NULL,
      is_admin        BOOLEAN DEFAULT false,
      PRIMARY KEY (conversation_id, user_id)
    );

    -- Сообщение БЕЗ plaintext content. Метаданные только.
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id       TEXT REFERENCES users(id),
      reply_to_id     TEXT REFERENCES messages(id),
      type            TEXT DEFAULT 'text' CHECK(type IN ('text','image','file','system')),
      attachment_url  TEXT,
      attachment_name TEXT,
      attachment_size BIGINT,
      attachment_mime TEXT,
      edited          BOOLEAN DEFAULT false,
      deleted         BOOLEAN DEFAULT false,
      created_at      BIGINT NOT NULL
    );

    -- Зашифрованная копия сообщения для каждого получателя
    -- Шифротекст здесь — единственное место хранения содержимого сообщения
    CREATE TABLE IF NOT EXISTS message_envelopes (
      message_id   TEXT REFERENCES messages(id) ON DELETE CASCADE,
      recipient_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      ciphertext   TEXT NOT NULL,
      iv           TEXT NOT NULL,
      PRIMARY KEY (message_id, recipient_id)
    );

    CREATE TABLE IF NOT EXISTS message_reads (
      message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
      user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
      read_at    BIGINT NOT NULL,
      PRIMARY KEY (message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
      endpoint   TEXT NOT NULL,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE(user_id, endpoint)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv   ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_conv_members    ON conversation_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_push_user       ON push_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_envelopes_recip ON message_envelopes(recipient_id, message_id);
  `);

  console.log('[PG] Schema initialized (E2E mode — only ciphertext stored)');
}

module.exports = { query, withTransaction, initSchema, pool };
