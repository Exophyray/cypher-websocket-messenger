const webpush = require('web-push');
const { query } = require('./db');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@cipher.local';

let enabled = false;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    enabled = true;
    console.log('[Push] Web Push configured');
  } catch (e) {
    console.error('[Push] VAPID setup failed:', e.message);
  }
} else {
  console.warn('[Push] VAPID keys not set — push notifications disabled. Run `npm run vapid` to generate.');
}

function getPublicKey() {
  return VAPID_PUBLIC || null;
}

async function subscribe(userId, subscription) {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error('Invalid subscription');
  }
  const { v4: uuidv4 } = require('uuid');
  await query(`
    INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id, endpoint) DO NOTHING
  `, [uuidv4(), userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, Date.now()]);
}

async function unsubscribe(userId, endpoint) {
  await query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
}

async function sendToUser(userId, payload) {
  if (!enabled) return;
  const { rows } = await query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
  const data = JSON.stringify(payload);

  await Promise.allSettled(rows.map(async sub => {
    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth }
    };
    try {
      await webpush.sendNotification(subscription, data);
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        // Expired/invalid → remove
        await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
      }
    }
  }));
}

module.exports = { getPublicKey, subscribe, unsubscribe, sendToUser, enabled };
