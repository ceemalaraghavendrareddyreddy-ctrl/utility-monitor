const express = require('express');
const db = require('../db');
const { requireAuth, requireIngestKey } = require('../authMiddleware');

const router = express.Router();

// GET /api/readings?building_id=1&type=energy&hours=24 — history for
// sparklines/trends. Session-authenticated (a dashboard user), and scoped:
// a non-admin can only read history for a building in their own customer.
router.get('/', requireAuth, (req, res) => {
  const buildingId = Number(req.query.building_id);
  const type = req.query.type;
  const hours = Number(req.query.hours) || 24;

  if (!buildingId || !['energy', 'water', 'tank_level'].includes(type)) {
    return res.status(400).json({ error: 'building_id and type (energy|water|tank_level) are required' });
  }

  if (req.user.role !== 'admin') {
    const building = db.prepare('SELECT customer_id FROM buildings WHERE id = ?').get(buildingId);
    if (!building || building.customer_id !== req.user.customerId) {
      return res.status(404).json({ error: 'building not found' });
    }
  }

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT value, timestamp FROM readings
       WHERE building_id = ? AND reading_type = ? AND timestamp >= ?
       ORDER BY timestamp ASC`
    )
    .all(buildingId, type, since);

  res.json(rows);
});

// POST /api/readings — ingest a reading. This is the seam a real gateway
// (Node-RED flow, Home Assistant, vendor API poller) calls instead of the
// simulator once real meters are connected — so it authenticates with an
// API key (see requireIngestKey), not a browser session cookie.
router.post('/', requireIngestKey, (req, res) => {
  const { building_id, reading_type, value, timestamp } = req.body || {};

  if (!building_id || !['energy', 'water', 'tank_level'].includes(reading_type) || typeof value !== 'number') {
    return res.status(400).json({
      error: 'building_id, reading_type (energy|water|tank_level) and numeric value are required',
    });
  }

  const ts = timestamp || new Date().toISOString();
  db.prepare(
    'INSERT INTO readings (building_id, reading_type, value, timestamp) VALUES (?, ?, ?, ?)'
  ).run(building_id, reading_type, value, ts);

  res.status(201).json({ ok: true });
});

module.exports = router;
