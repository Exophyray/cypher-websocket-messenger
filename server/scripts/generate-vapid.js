const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();
console.log('\n┌─────── VAPID KEYS (add to .env) ───────┐');
console.log('│ VAPID_PUBLIC_KEY  =', keys.publicKey);
console.log('│ VAPID_PRIVATE_KEY =', keys.privateKey);
console.log('└─────────────────────────────────────────┘\n');
console.log('Add to your .env file:');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:admin@example.com\n`);
