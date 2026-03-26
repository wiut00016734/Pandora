const bcrypt = require('bcryptjs');

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateKey() {
  const seg = () => Array.from({ length: 4 }, () =>
    CHARS[Math.floor(Math.random() * CHARS.length)]
  ).join('');
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}

async function hashKey(key) {
  return bcrypt.hash(key.toUpperCase(), 12);
}

async function verifyKey(key, hash) {
  return bcrypt.compare(key.toUpperCase(), hash);
}

function sevenDaysFromNow() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString();
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

module.exports = { generateKey, hashKey, verifyKey, sevenDaysFromNow, formatBytes };
