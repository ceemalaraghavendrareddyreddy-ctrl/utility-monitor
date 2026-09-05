const express = require('express');
const db = require('../db');
const { requireAdmin, requireWrite } = require('../authMiddleware');

const router = express.Router();

// Turns "Oceanview Towers" into "oceanview-towers" for a default slug when
// the caller doesn't supply one. Not guaranteed unique on its own — the
// UNIQUE constraint on customers.slug is the real guard (see POST /).
function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// GET /api/customers — the portfolio switcher's data source. A non-admin
// user only ever sees their own customer (so the switcher naturally has one
// option); an admin sees every portfolio.
router.get('/', (req, res) => {
  const rows =
    req.user.role === 'admin'
      ? db.prepare('SELECT id, name, slug, alert_email FROM customers ORDER BY id').all()
      : db.prepare('SELECT id, name, slug, alert_email FROM customers WHERE id = ?').all(req.user.customerId);

  res.json(rows.map((c) => ({ id: c.id, name: c.name, slug: c.slug, alertEmail: c.alert_email })));
});

// PATCH /api/customers/:id — currently only supports updating the "instant
// alert" recipient email. Portfolio-wide settings, so only admin/owner —
// not a manager (scoped to one building, not the whole customer) or a
// resident (requireWrite blocks it outright as read-only).
router.patch('/:id', requireWrite, (req, res) => {
  const customerId = Number(req.params.id);
  if (!['admin', 'owner'].includes(req.user.role)) {
    return res.status(403).json({ error: 'admin or owner role required' });
  }
  if (req.user.role !== 'admin' && customerId !== req.user.customerId) {
    return res.status(403).json({ error: 'cannot modify another customer' });
  }

  const { alert_email: alertEmail } = req.body || {};
  if (typeof alertEmail !== 'string' && alertEmail !== null) {
    return res.status(400).json({ error: 'alert_email must be a string or null' });
  }

  const result = db.prepare('UPDATE customers SET alert_email = ? WHERE id = ?').run(alertEmail, customerId);
  if (result.changes === 0) return res.status(404).json({ error: 'customer not found' });

  res.json({ ok: true, id: customerId, alertEmail });
});

// POST /api/customers — onboard a new client portfolio. Admin only: this is
// ops tooling, not something a customer does for themselves. Body:
// { name, slug?, alertEmail? }. slug defaults to a slugified name if omitted.
router.post('/', requireAdmin, (req, res) => {
  const { name, slug, alert_email: alertEmail } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const finalSlug = typeof slug === 'string' && slug.trim() ? slugify(slug) : slugify(name);
  if (!finalSlug) return res.status(400).json({ error: 'could not derive a slug from name — pass slug explicitly' });

  const existing = db.prepare('SELECT id FROM customers WHERE slug = ?').get(finalSlug);
  if (existing) return res.status(409).json({ error: `slug "${finalSlug}" is already in use` });

  const result = db
    .prepare('INSERT INTO customers (name, slug, alert_email) VALUES (?, ?, ?)')
    .run(name.trim(), finalSlug, typeof alertEmail === 'string' ? alertEmail : null);

  res.status(201).json({ id: Number(result.lastInsertRowid), name: name.trim(), slug: finalSlug, alertEmail: alertEmail || null });
});

module.exports = router;
