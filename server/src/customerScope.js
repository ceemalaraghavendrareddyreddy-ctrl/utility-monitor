// Resolves which customer/portfolio a request is scoped to. Requires
// requireAuth (see authMiddleware.js) to have run first and set req.user.
//
// - A non-admin user is ALWAYS locked to their own customer_id — any
//   ?customer_id= they pass is ignored. This is the real access-control
//   boundary; before auth existed, this file's old version trusted the
//   query param outright, which was explicitly flagged in the README as
//   "data isolation, not access control". It's a real boundary now.
// - An admin user has no fixed customer_id, so they may pass ?customer_id=
//   to view any portfolio (defaulting to the first customer if omitted).
function resolveCustomerId(req) {
  if (!req.user) throw new Error('resolveCustomerId called without an authenticated req.user');

  if (req.user.role !== 'admin') return req.user.customerId;

  const parsed = Number(req.query.customer_id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

// A 'manager' account is scoped to exactly one building within their
// customer (see db.js users.building_id), not the whole portfolio like
// owner/resident. Returns that building's id, or null for every other role
// (nothing to restrict further beyond resolveCustomerId).
function resolveBuildingRestriction(req) {
  if (!req.user) throw new Error('resolveBuildingRestriction called without an authenticated req.user');
  return req.user.role === 'manager' ? req.user.buildingId : null;
}

module.exports = { resolveCustomerId, resolveBuildingRestriction };
