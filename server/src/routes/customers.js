const express = require('express');
const db = require('../db');

const router = express.Router();

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
// alert" recipient email. A non-admin may only patch their own customer.
router.patch('/:id', (req, res) => {
  const customerId = Number(req.params.id);
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

module.exports = router;
