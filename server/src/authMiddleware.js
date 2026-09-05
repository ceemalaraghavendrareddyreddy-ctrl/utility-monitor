const { getSession } = require('./auth');

// Guards the dashboard-facing API (customers/buildings/summary/tanks/devices,
// and reading history) behind a logged-in session. Reads the httpOnly
// "session" cookie set by POST /api/auth/login.
function requireAuth(req, res, next) {
  const session = getSession(req.cookies?.session);
  if (!session) return res.status(401).json({ error: 'not authenticated' });
  req.user = session;
  next();
}

// Guards machine-to-machine ingestion (POST /api/readings) — a real gateway
// can't do an interactive login, so it authenticates with a static API key
// instead of a session cookie. If INGEST_API_KEY isn't set, ingestion is
// left open (this is still a local demo); set it before exposing the server
// beyond localhost.
function requireIngestKey(req, res, next) {
  const configuredKey = process.env.INGEST_API_KEY;
  if (!configuredKey) return next(); // no key configured — demo mode, allow through
  if (req.get('x-api-key') === configuredKey) return next();
  return res.status(401).json({ error: 'missing or invalid x-api-key' });
}

// Guards admin-only endpoints (customer/building/user onboarding). Must run
// after requireAuth has set req.user.
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'admin role required' });
  next();
}

// Guards write endpoints against the 'resident' role — a resident sees
// their whole customer's portfolio (like an owner) but read-only: no
// thresholds, no alert-email changes, no device control. Every other role
// (admin/owner/manager) may write within whatever scope its other checks
// (customerScope.js, or an inline building_id check) allow.
function requireWrite(req, res, next) {
  if (req.user?.role === 'resident') return res.status(403).json({ error: 'read-only account' });
  next();
}

module.exports = { requireAuth, requireIngestKey, requireAdmin, requireWrite };
