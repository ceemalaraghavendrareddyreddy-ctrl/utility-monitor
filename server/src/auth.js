// Password hashing (Node's built-in crypto.scrypt — no native module needed,
// unlike bcrypt) and an in-memory session store. Good enough for a demo on
// one process; a real deployment should move sessions to a shared store
// (Redis, a DB table) so they survive a restart and work across instances.
const crypto = require('crypto');

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

// token -> { userId, username, role, customerId, expiresAt }
const sessions = new Map();

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    userId: user.id,
    username: user.username,
    role: user.role,
    customerId: user.customer_id,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  sessions.delete(token);
}

module.exports = { hashPassword, verifyPassword, createSession, getSession, destroySession };
