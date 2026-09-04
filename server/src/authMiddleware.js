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

module.exports = { requireAuth, requireIngestKey };
