const express = require('express');
const db = require('../db');
const { resolveCustomerId, resolveBuildingRestriction } = require('../customerScope');

const router = express.Router();

const LEAK_RATE_PCT_PER_MIN = 2; // keep in sync with routes/tanks.js

// GET /api/summary?customer_id= — one customer's community-wide totals for
// the top of the dashboard
router.get('/', (req, res) => {
  const customerId = resolveCustomerId(req);
  const buildingRestriction = resolveBuildingRestriction(req);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // A manager is scoped to one building (resolveBuildingRestriction), so
  // both queries below add "AND b.id = ?" for that role — same shape, just
  // one more param — rather than a second near-duplicate query.
  const buildingFilter = buildingRestriction ? 'AND b.id = ?' : '';
  const buildingFilterArgs = buildingRestriction ? [buildingRestriction] : [];

  const totals = db
    .prepare(
      `SELECT r.reading_type, COALESCE(SUM(r.value), 0) AS total
       FROM readings r
       JOIN buildings b ON b.id = r.building_id
       WHERE b.customer_id = ? ${buildingFilter} AND r.timestamp >= ? AND r.reading_type IN ('energy', 'water')
       GROUP BY r.reading_type`
    )
    .all(customerId, ...buildingFilterArgs, todayStart.toISOString());

  const energy = totals.find((t) => t.reading_type === 'energy')?.total || 0;
  const water = totals.find((t) => t.reading_type === 'water')?.total || 0;

  const buildings = db
    .prepare(
      `SELECT b.id, b.energy_threshold_kwh, b.water_threshold_l, b.tank_low_threshold_pct,
              COALESCE(SUM(CASE WHEN r.reading_type = 'energy' THEN r.value END), 0) AS energy_today,
              COALESCE(SUM(CASE WHEN r.reading_type = 'water' THEN r.value END), 0) AS water_today
       FROM buildings b
       LEFT JOIN readings r ON r.building_id = b.id AND r.timestamp >= ?
       WHERE b.customer_id = ? ${buildingFilter}
       GROUP BY b.id`
    )
    .all(todayStart.toISOString(), customerId, ...buildingFilterArgs);

  const recentTankReadings = db.prepare(
    `SELECT value, timestamp FROM readings
     WHERE building_id = ? AND reading_type = 'tank_level'
     ORDER BY timestamp DESC LIMIT 2`
  );

  let alertCount = 0;
  for (const b of buildings) {
    let hasAlert = b.energy_today >= b.energy_threshold_kwh || b.water_today >= b.water_threshold_l;

    const [latest, prev] = recentTankReadings.all(b.id);
    if (latest && latest.value <= b.tank_low_threshold_pct) hasAlert = true;
    if (latest && prev) {
      const minutesElapsed = (new Date(latest.timestamp) - new Date(prev.timestamp)) / 60000;
      if (minutesElapsed > 0 && (prev.value - latest.value) / minutesElapsed >= LEAK_RATE_PCT_PER_MIN) {
        hasAlert = true;
      }
    }

    if (hasAlert) alertCount += 1;
  }

  res.json({
    energyTodayKwh: Number(energy.toFixed(2)),
    waterTodayL: Number(water.toFixed(1)),
    buildingCount: buildings.length,
    alertCount,
    generatedAt: new Date().toISOString(),
  });
});

module.exports = router;
