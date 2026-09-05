const express = require('express');
const db = require('../db');
const { resolveCustomerId, resolveBuildingRestriction } = require('../customerScope');

const router = express.Router();

// A drop faster than this (percent per minute) is flagged as a probable
// leak/burst rather than normal usage — normal draw-down is well under 1%/min
// even at peak, so this has headroom before it fires on ordinary usage.
const LEAK_RATE_PCT_PER_MIN = 2;

// GET /api/tanks?customer_id= — current level, low-level alert and leak
// alert per building, for one customer's portfolio
router.get('/', (req, res) => {
  const customerId = resolveCustomerId(req);
  const buildingRestriction = resolveBuildingRestriction(req);
  const buildings = buildingRestriction
    ? db.prepare('SELECT * FROM buildings WHERE customer_id = ? AND id = ? ORDER BY id').all(customerId, buildingRestriction)
    : db.prepare('SELECT * FROM buildings WHERE customer_id = ? ORDER BY id').all(customerId);

  const recentReadings = db.prepare(
    `SELECT value, timestamp FROM readings
     WHERE building_id = ? AND reading_type = 'tank_level'
     ORDER BY timestamp DESC LIMIT 5`
  );

  const result = buildings.map((b) => {
    const rows = recentReadings.all(b.id);
    const latest = rows[0];
    const levelPct = latest ? Number(latest.value.toFixed(1)) : null;

    let leakAlert = false;
    if (rows.length >= 2) {
      const prev = rows[1];
      const minutesElapsed = (new Date(latest.timestamp) - new Date(prev.timestamp)) / 60000;
      if (minutesElapsed > 0) {
        const dropRate = (prev.value - latest.value) / minutesElapsed;
        leakAlert = dropRate >= LEAK_RATE_PCT_PER_MIN;
      }
    }

    const lowLevelAlert = levelPct !== null && levelPct <= b.tank_low_threshold_pct;

    return {
      buildingId: b.id,
      buildingName: b.name,
      levelPct,
      levelLitres: levelPct !== null ? Math.round((levelPct / 100) * b.tank_capacity_l) : null,
      capacityLitres: b.tank_capacity_l,
      lowThresholdPct: b.tank_low_threshold_pct,
      lowLevelAlert,
      leakAlert,
      lastReadingAt: latest ? latest.timestamp : null,
    };
  });

  res.json(result);
});

module.exports = router;
