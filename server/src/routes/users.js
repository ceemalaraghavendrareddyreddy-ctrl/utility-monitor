const express = require('express');
const db = require('../db');
const { hashPassword, generatePassword } = require('../auth');
const { requireAdmin } = require('../authMiddleware');

const router = express.Router();

// GET /api/users?customer_id= — admin only (login accounts aren't shown on
// the customer-facing dashboard at all). Omit customer_id to list everyone.
router.get('/', requireAdmin, (req, res) => {
  const customerId = Number(req.query.customer_id);
  const rows = Number.isInteger(customerId) && customerId > 0
    ? db.prepare('SELECT id, customer_id, building_id, username, role FROM users WHERE customer_id = ? ORDER BY id').all(customerId)
    : db.prepare('SELECT id, customer_id, building_id, username, role FROM users ORDER BY id').all();

  res.json(
    rows.map((u) => ({ id: u.id, customerId: u.customer_id, buildingId: u.building_id, username: u.username, role: u.role }))
  );
});

// POST /api/users — onboard a login. Admin only: creating accounts is ops
// tooling, same rationale as POST /api/customers and POST /api/buildings.
// Body: { customerId?, buildingId?, username, role? }. role defaults to
// "owner" — creating another "admin" account has to go through this same
// endpoint too, but only an existing admin can call it, so that's not a
// privilege-escalation path.
//
// Four roles, two independent axes (see db.js users table comment):
//   admin    - customerId/buildingId ignored, sees every portfolio
//   owner    - customerId required, full read/write on that portfolio
//   manager  - buildingId required, full read/write on just that building
//              (its customerId is derived from the building, not passed)
//   resident - customerId required, read-only on that whole portfolio
//
// The password is randomly generated (same generator as first-run demo
// seeding) and returned exactly once in this response — it is never
// stored in plaintext or retrievable later. Hand it to the customer and
// have them change it once a "change password" endpoint exists (not built
// yet — see README "Next steps").
router.post('/', requireAdmin, (req, res) => {
  const { customerId, buildingId, username, role } = req.body || {};

  const finalRole = role === undefined ? 'owner' : role;
  if (!['owner', 'admin', 'manager', 'resident'].includes(finalRole)) {
    return res.status(400).json({ error: 'role must be one of "owner", "admin", "manager", "resident"' });
  }

  let customerIdNum = null;
  let buildingIdNum = null;

  if (finalRole === 'manager') {
    buildingIdNum = Number(buildingId);
    if (!Number.isInteger(buildingIdNum) || buildingIdNum <= 0) {
      return res.status(400).json({ error: 'buildingId is required for role "manager"' });
    }
    const building = db.prepare('SELECT id, customer_id FROM buildings WHERE id = ?').get(buildingIdNum);
    if (!building) return res.status(404).json({ error: 'building not found' });
    customerIdNum = building.customer_id; // derived, not caller-supplied
  } else if (finalRole === 'owner' || finalRole === 'resident') {
    customerIdNum = Number(customerId);
    if (!Number.isInteger(customerIdNum) || customerIdNum <= 0) {
      return res.status(400).json({ error: `customerId is required for role "${finalRole}"` });
    }
    const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(customerIdNum);
    if (!customer) return res.status(404).json({ error: 'customer not found' });
  }
  // finalRole === 'admin': both stay null

  if (typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'username is required' });
  }
  const trimmedUsername = username.trim();
  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(trimmedUsername);
  if (existing) return res.status(409).json({ error: `username "${trimmedUsername}" is already taken` });

  const password = generatePassword();
  const { salt, hash } = hashPassword(password);
  const result = db
    .prepare(
      'INSERT INTO users (customer_id, building_id, username, password_salt, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(customerIdNum, buildingIdNum, trimmedUsername, salt, hash, finalRole);

  res.status(201).json({
    id: Number(result.lastInsertRowid),
    customerId: customerIdNum,
    buildingId: buildingIdNum,
    username: trimmedUsername,
    role: finalRole,
    password, // shown once — the caller must hand this to the customer now
  });
});

// DELETE /api/users/:id — offboard a login. Admin only. Also destroys any
// active sessions for that user so a deleted account is logged out
// immediately rather than staying valid until its session expires.
router.delete('/:id', requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'user not found' });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();

  res.json({ ok: true, id: userId });
});

module.exports = router;
