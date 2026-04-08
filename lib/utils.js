const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateKey() {
  const seg = () => Array.from({ length: 4 }, () =>
    CHARS[Math.floor(Math.random() * CHARS.length)]
  ).join('');
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}

function generateViewerKey() {
  const seg = () => Array.from({ length: 4 }, () =>
    CHARS[Math.floor(Math.random() * CHARS.length)]
  ).join('');
  return `VIEW-${seg()}-${seg()}`;
}

async function hashKey(key) {
  return bcrypt.hash(key.toUpperCase().trim(), 12);
}

async function verifyKey(key, hash) {
  return bcrypt.compare(key.toUpperCase().trim(), hash);
}

function keyIndex(key) {
  return crypto.createHash('sha256').update(key.toUpperCase().trim()).digest('hex');
}

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const NICKNAMES = [
  'RedPanda','BlueFox','GreenOwl','PurpleBear','OrangeWolf',
  'TealEagle','PinkLion','YellowDeer','CyanHawk','MagentaCat',
  'LimeTiger','CoralDove','IndigoElk','AmberSeal','CrimsonBat'
];
const AVATAR_COLORS = [
  '#e74c3c','#3498db','#2ecc71','#9b59b6','#e67e22',
  '#1abc9c','#e91e8c','#f1c40f','#00bcd4','#ff5722',
  '#8bc34a','#ff7043','#5c6bc0','#ffb300','#dc143c'
];

function randomIdentity() {
  const idx = Math.floor(Math.random() * NICKNAMES.length);
  return { nickname: NICKNAMES[idx], avatar_color: AVATAR_COLORS[idx] };
}

module.exports = {
  generateKey, generateViewerKey, hashKey, verifyKey,
  keyIndex, daysFromNow, formatBytes, randomIdentity
};