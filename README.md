# 🔐 Cipher Messenger

A real-time web messenger with end-to-end encryption. Messages are encrypted in the browser, and the server only stores encrypted data.

## Features

- End-to-end encrypted messaging
- Private and group chats
- Real-time communication with WebSockets
- Typing indicators
- Read receipts
- Online status
- Message editing and deletion
- File and image uploads
- Push notifications
- Docker support

## Tech Stack

**Backend**
- Node.js
- Express
- WebSocket (`ws`)
- PostgreSQL

**Frontend**
- React
- Web Crypto API
- Service Worker

**Authentication**
- JWT
- bcrypt

**Encryption**
- ECDH P-256
- AES-256-GCM

## How encryption works

1. When a user signs in, the browser generates an ECDH key pair.
2. The private key stays in the browser, while the public key is sent to the server.
3. Before sending a message, the sender encrypts it separately for each chat participant.
4. The server stores only encrypted message copies.
5. Each recipient decrypts their own copy locally in the browser.

The server never has access to the original message text.

## Running with Docker

```bash
cp .env.example .env

# Generate VAPID keys
docker compose run --rm server npm run vapid

# Copy the generated keys into .env

# Build and start
docker compose up -d --build
```

Open:

```
http://localhost:8080
```

Useful commands:

```bash
docker compose ps
docker compose logs -f
docker compose down
docker compose down -v
```

## Running locally

Requirements:

- Node.js 22+
- PostgreSQL

### Server

```bash
cd server
cp .env.example .env
npm install
npm run vapid
npm start
```

### Client

```bash
cd client
npm install
npm start
```

Open:

```
http://localhost:3000
```

## Database

The database is split into two parts:

- `messages` – message metadata
- `message_envelopes` – encrypted message data

No plaintext messages are stored in the database.

## API

### REST

```
/api/auth/*
/api/users/*
/api/conversations/*
/api/upload
/api/push/*
```

### WebSocket

```
ws://host/ws?token=JWT
```

Events:

- `message:send`
- `message:edit`
- `message:delete`
- `message:read`
- `typing:start`
- `typing:stop`
- `ping`

## Current limitations

- The private key is stored in `localStorage`. A production application should encrypt it before storage.
- Reply previews only work if the original message has already been downloaded by the client.