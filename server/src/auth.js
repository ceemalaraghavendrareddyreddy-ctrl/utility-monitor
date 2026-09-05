// Password hashing (Node's built-in crypto.scrypt — no native module needed,
// unlike bcrypt) and a DB-backed session store (the `sessions` table in
// db.js) so logins survive a server restart and would be shared correctly
// across multiple instances pointed at the same DB file.
//
// db.js requires this file (for hashPassword, used while seeding demo
// accounts), so requiring db.js back at module-load time here would be a
// circular require that resolves to an empty object. Each function below
// requires('./db') lazily instead — by the time login/session calls
// actually happen, db.js has fully finished loading and Node's require
// cache just returns it.
const crypto = require('crypto');

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Readable-but-strong random password: base32-ish alphabet with no
// ambiguous characters (0/O, 1/l/I), easy to read off a deploy log or an
// onboarding API response and type into a login form without transcription
// errors. Used both for first-run demo account seeding (db.js) and for
// admin-created accounts (routes/users.js).
function generatePassword(length = 12) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(expectedHash, 'hex');
  // timingSafeEqual requires equal-length buffers, and throws otherwise —
  // guard that rather than let a length mismatch leak via an exception.
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function createSession(user) {
  const db = require('./db');
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.prepare(
    `INSERT INTO sessions (token, user_id, username, role, customer_id, building_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(token, user.id, user.username, user.role, user.customer_id, user.building_id, expiresAt);
  return token;
}

function getSession(token) {
  if (!token) return null;
  const db = require('./db');
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return {
    userId: row.user_id,
    username: row.username,
    role: row.role,
    customerId: row.customer_id,
    buildingId: row.building_id,
    expiresAt: row.expires_at,
  };
}

function destroySession(token) {
  const db = require('./db');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Best-effort sweep of expired sessions — called on server start and could
// be put on an interval; SQLite has no TTL of its own, and lazy per-lookup
// deletion (see getSession) only cleans up rows that are actually looked up
// again, so a periodic sweep keeps abandoned/expired rows from piling up.
function sweepExpiredSessions() {
  const db = require('./db');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

module.exports = {
  generatePassword,
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  destroySession,
  sweepExpiredSessions,
};
