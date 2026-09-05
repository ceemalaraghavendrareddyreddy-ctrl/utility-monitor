const express = require('express');
const db = require('../db');
const { resolveCustomerId, resolveBuildingRestriction } = require('../customerScope');
const { requireWrite } = require('../authMiddleware');

const router = express.Router();

// GET /api/devices?customer_id= — remotely controllable IoT devices (pumps,
// valves, ...) for one customer's buildings (or just one building, for a
// manager scoped to it)
router.get('/', (req, res) => {
  const customerId = resolveCustomerId(req);
  const buildingRestriction = resolveBuildingRestriction(req);
  const rows = buildingRestriction
    ? db
        .prepare(
          `SELECT d.id, d.building_id, b.name AS building_name, d.name, d.device_type, d.status, d.updated_at
           FROM devices d JOIN buildings b ON b.id = d.building_id
           WHERE b.customer_id = ? AND b.id = ?
           ORDER BY d.building_id, d.id`
        )
        .all(customerId, buildingRestriction)
    : db
        .prepare(
          `SELECT d.id, d.building_id, b.name AS building_name, d.name, d.device_type, d.status, d.updated_at
           FROM devices d JOIN buildings b ON b.id = d.building_id
           WHERE b.customer_id = ?
           ORDER BY d.building_id, d.id`
        )
        .all(customerId);

  res.json(
    rows.map((r) => ({
      id: r.id,
      buildingId: r.building_id,
      buildingName: r.building_name,
      name: r.name,
      deviceType: r.device_type,
      status: r.status,
      updatedAt: r.updated_at,
    }))
  );
});

// POST /api/devices/:id/command — remote activation ("activate from a
// distance"). Body: { action: "on" | "off" }. This is the seam a real
// BMS/IoT gateway would subscribe to (MQTT publish, vendor API call, etc.)
// to actually drive the physical pump/valve; here it also feeds the tank
// simulator directly, so toggling it off visibly stops that tank refilling.
router.post('/:id/command', requireWrite, (req, res) => {
  const deviceId = Number(req.params.id);
  const { action } = req.body || {};

  if (!['on', 'off'].includes(action)) {
    return res.status(400).json({ error: 'action must be "on" or "off"' });
  }

  const device = db
    .prepare(
      `SELECT d.*, b.customer_id FROM devices d JOIN buildings b ON b.id = d.building_id WHERE d.id = ?`
    )
    .get(deviceId);
  if (!device) return res.status(404).json({ error: 'device not found' });
  if (req.user.role !== 'admin' && device.customer_id !== req.user.customerId) {
    return res.status(404).json({ error: 'device not found' }); // 404, not 403 — don't reveal it exists
  }
  if (req.user.role === 'manager' && device.building_id !== req.user.buildingId) {
    return res.status(404).json({ error: 'device not found' });
  }

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('UPDATE devices SET status = ?, updated_at = ? WHERE id = ?').run(action, now, deviceId);
    db.prepare('INSERT INTO device_commands (device_id, action, issued_at) VALUES (?, ?, ?)').run(
      deviceId,
      action,
      now
    );
  });
  tx();

  res.json({ ok: true, id: deviceId, status: action, updatedAt: now });
});

module.exports = router;
