const express = require('express');
const db = require('../db');
const { resolveCustomerId } = require('../customerScope');

const router = express.Router();

// GET /api/buildings?customer_id= — list one customer's buildings with
// today's totals and alert status
router.get('/', (req, res) => {
  const customerId = resolveCustomerId(req);
  const buildings = db.prepare('SELECT * FROM buildings WHERE customer_id = ? ORDER BY id').all(customerId);
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

module.exports = router;
