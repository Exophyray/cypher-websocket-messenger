const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'cipher-super-secret-key-change-in-prod';
const JWT_EXPIRES = '7d';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'No token' });
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  try {
    req.user = verifyToken(token);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function wsAuth(token) {
  try { return verifyToken(token); } catch { return null; }
}

module.exports = { signToken, verifyToken, authMiddleware, wsAuth };
