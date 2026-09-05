const express = require('express');
const db = require('../db');
const { resolveCustomerId, resolveBuildingRestriction } = require('../customerScope');
const { requireAdmin, requireWrite } = require('../authMiddleware');

const router = express.Router();

const THRESHOLD_DEFAULTS = {
  energyThresholdKwh: 55,
  waterThresholdL: 900,
  tankLowThresholdPct: 25,
  tankCapacityL: 10000,
};

// Pulls the four threshold/capacity fields out of a request body, applying
// defaults for POST (a brand-new building) and leaving fields undefined for
// PATCH (so an omitted field is left alone rather than reset). Returns null
// for any field the caller supplied but that isn't a finite number.
function parseThresholds(body, { withDefaults }) {
  const fields = {
    energyThresholdKwh: 'energy_threshold_kwh',
    waterThresholdL: 'water_threshold_l',
    tankLowThresholdPct: 'tank_low_threshold_pct',
    tankCapacityL: 'tank_capacity_l',
  };
  const out = {};
  for (const [key, column] of Object.entries(fields)) {
    if (body[key] === undefined) {
      out[column] = withDefaults ? THRESHOLD_DEFAULTS[key] : undefined;
      continue;
    }
    const num = Number(body[key]);
    if (!Number.isFinite(num) || num <= 0) return { error: `${key} must be a positive number` };
    out[column] = num;
  }
  return { values: out };
}

// GET /api/buildings?customer_id= — list one customer's buildings with
// today's totals and alert status
router.get('/', (req, res) => {
  const customerId = resolveCustomerId(req);
  const buildingRestriction = resolveBuildingRestriction(req);
  const buildings = buildingRestriction
    ? db.prepare('SELECT * FROM buildings WHERE customer_id = ? AND id = ? ORDER BY id').all(customerId, buildingRestriction)
    : db.prepare('SELECT * FROM buildings WHERE customer_id = ? ORDER BY id').all(customerId);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const totalToday = db.prepare(`
    SELECT COALESCE(SUM(value), 0) AS total
    FROM readings
    WHERE building_id = ? AND reading_type = ? AND timestamp >= ?
  `);

  const result = buildings.map((b) => {
    const energyToday = totalToday.get(b.id, 'energy', todayStart.toISOString()).total;
    const waterToday = totalToday.get(b.id, 'water', todayStart.toISOString()).total;
    return {
      id: b.id,
      name: b.name,
      energyThresholdKwh: b.energy_threshold_kwh,
      waterThresholdL: b.water_threshold_l,
      energyTodayKwh: Number(energyToday.toFixed(2)),
      waterTodayL: Number(waterToday.toFixed(1)),
      energyAlert: energyToday >= b.energy_threshold_kwh,
      waterAlert: waterToday >= b.water_threshold_l,
    };
  });

  res.json(result);
});

// POST /api/buildings — onboard a new building under a customer. Admin
// only, same rationale as POST /api/customers. Body:
// { customerId, name, energyThresholdKwh?, waterThresholdL?,
//   tankLowThresholdPct?, tankCapacityL? } — thresholds default to the same
// values the seed data uses if omitted. Also seeds one "Tank Inlet Pump"
// device for the building, matching what db.js does for the demo data, so
// a newly onboarded building is immediately controllable from the
// dashboard rather than needing a separate manual step.
router.post('/', requireAdmin, (req, res) => {
  const { customerId, name } = req.body || {};
  const customerIdNum = Number(customerId);
  if (!Number.isInteger(customerIdNum) || customerIdNum <= 0) {
    return res.status(400).json({ error: 'customerId is required' });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(customerIdNum);
  if (!customer) return res.status(404).json({ error: 'customer not found' });

  const parsed = parseThresholds(req.body || {}, { withDefaults: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const t = parsed.values;

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO buildings
          (customer_id, name, energy_threshold_kwh, water_threshold_l, tank_low_threshold_pct, tank_capacity_l)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(customerIdNum, name.trim(), t.energy_threshold_kwh, t.water_threshold_l, t.tank_low_threshold_pct, t.tank_capacity_l);
    const buildingId = Number(result.lastInsertRowid);
    db.prepare(
      `INSERT INTO devices (building_id, name, device_type, status, updated_at) VALUES (?, 'Tank Inlet Pump', 'pump', 'on', ?)`
    ).run(buildingId, new Date().toISOString());
    return buildingId;
  });
  const buildingId = tx();

  res.status(201).json({
    id: buildingId,
    customerId: customerIdNum,
    name: name.trim(),
    energyThresholdKwh: t.energy_threshold_kwh,
    waterThresholdL: t.water_threshold_l,
    tankLowThresholdPct: t.tank_low_threshold_pct,
    tankCapacityL: t.tank_capacity_l,
  });
});

// PATCH /api/buildings/:id — tune a building's name/thresholds/capacity
// (README "Next steps": these start at demo defaults and need real values
// per building). Admin may edit any building; an owner may edit any
// building in their own customer's portfolio; a manager may only edit
// their one assigned building. requireWrite blocks 'resident' outright.
router.patch('/:id', requireWrite, (req, res) => {
  const buildingId = Number(req.params.id);
  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId);
  if (!building) return res.status(404).json({ error: 'building not found' });
  if (req.user.role !== 'admin' && building.customer_id !== req.user.customerId) {
    return res.status(404).json({ error: 'building not found' }); // don't reveal it exists
  }
  if (req.user.role === 'manager' && building.id !== req.user.buildingId) {
    return res.status(404).json({ error: 'building not found' });
  }

  const parsed = parseThresholds(req.body || {}, { withDefaults: false });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const t = parsed.values;
  const { name } = req.body || {};
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return res.status(400).json({ error: 'name must be a non-empty string' });
  }

  db.prepare(
    `UPDATE buildings SET
      name = COALESCE(?, name),
      energy_threshold_kwh = COALESCE(?, energy_threshold_kwh),
      water_threshold_l = COALESCE(?, water_threshold_l),
      tank_low_threshold_pct = COALESCE(?, tank_low_threshold_pct),
      tank_capacity_l = COALESCE(?, tank_capacity_l)
     WHERE id = ?`
  ).run(
    name !== undefined ? name.trim() : null,
    t.energy_threshold_kwh ?? null,
    t.water_threshold_l ?? null,
    t.tank_low_threshold_pct ?? null,
    t.tank_capacity_l ?? null,
    buildingId
  );

  const updated = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId);
  res.json({
    id: updated.id,
    customerId: updated.customer_id,
    name: updated.name,
    energyThresholdKwh: updated.energy_threshold_kwh,
    waterThresholdL: updated.water_threshold_l,
    tankLowThresholdPct: updated.tank_low_threshold_pct,
    tankCapacityL: updated.tank_capacity_l,
  });
});

module.exports = router;
