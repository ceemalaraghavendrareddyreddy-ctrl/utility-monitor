const express = require('express');
const db = require('../db');
const { verifyPassword, createSession, destroySession } = require('../auth');
const { requireAuth } = require('../authMiddleware');

const router = express.Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  // NOTE: no `secure: true` — this demo runs on plain http://localhost.
  // Set secure:true (and serve over HTTPS) before deploying anywhere real,
  // or the session cookie travels in the clear.
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// POST /api/auth/login — { username, password }
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  // Case-insensitive on username (mobile keyboards love auto-capitalizing the
  // first letter) — password stays case-sensitive, as it should.
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username.trim());
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    return res.status(401).json({ error: 'invalid username or password' });
  }

  const token = createSession(user);
  res.cookie('session', token, COOKIE_OPTIONS);
  res.json({
    ok: true,
    username: user.username,
    role: user.role,
    customerId: user.customer_id,
    buildingId: user.building_id,
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  if (req.cookies?.session) destroySession(req.cookies.session);
  res.clearCookie('session');
  res.json({ ok: true });
});

// GET /api/auth/me — who's currently logged in, for the dashboard to check
// on load before rendering anything customer-specific.
router.get('/me', requireAuth, (req, res) => {
  const customer = req.user.customerId
    ? db.prepare('SELECT id, name FROM customers WHERE id = ?').get(req.user.customerId)
    : null;
  const building = req.user.buildingId
    ? db.prepare('SELECT id, name FROM buildings WHERE id = ?').get(req.user.buildingId)
    : null;
  res.json({
    username: req.user.username,
    role: req.user.role,
    customerId: req.user.customerId,
    customerName: customer ? customer.name : null,
    buildingId: req.user.buildingId,
    buildingName: building ? building.name : null,
  });
});

module.exports = router;
