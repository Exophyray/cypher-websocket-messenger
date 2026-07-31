require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const routes = require('./routes');
const { setupWebSocket } = require('./ws');
const { initSchema, query } = require('./db');

const PORT = process.env.PORT || 3001;
const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: '*', methods: ['GET','POST','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));

app.use('/api/auth', rateLimit({ windowMs: 15*60*1000, max: 20, message: { error: 'Too many requests' } }));
app.use('/api', rateLimit({ windowMs: 60*1000, max: 600 }));

app.use(express.json({ limit: '10mb' }));

// Serve uploaded files
app.use('/uploads', express.static(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads')));

app.use('/api', routes);

app.get('/health', async (req, res) => {
  try {
    const { rows: [u] } = await query('SELECT COUNT(*)::int as c FROM users');
    const { rows: [m] } = await query('SELECT COUNT(*)::int as c FROM messages');
    res.json({ status: 'ok', uptime: process.uptime(), users: u.c, messages: m.c });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// Serve static client build
const clientBuild = path.join(__dirname, '../client/build');
const fs = require('fs');
if (fs.existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  app.get('*', (req, res) => res.sendFile(path.join(clientBuild, 'index.html')));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wss);

(async () => {
  await initSchema();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n┌────────────────────────────────────────┐`);
    console.log(`│  Cipher Messenger Server v2            │`);
    console.log(`│  HTTP  → http://localhost:${PORT}         │`);
    console.log(`│  WS    → ws://localhost:${PORT}/ws        │`);
    console.log(`│  DB    → PostgreSQL                    │`);
    console.log(`└────────────────────────────────────────┘\n`);
  });
})().catch(err => {
  console.error('[FATAL] Startup failed:', err);
  process.exit(1);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));
