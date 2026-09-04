// Stands in for stages 1 & 2 of the architecture (physical meter + gateway)
// until real meters/sensors are wired up. Generates plausible hourly-ish
// readings per building so the dashboard has live and historical data to show.
// Swap this module out for a real ingest path (vendor API poll, Modbus/BACnet
// bridge, or LoRaWAN network-server webhook) without touching the API or dashboard.
//
// Also simulates the tank-level side of the water platform: each building's
// storage tank drains over time, a pump device (see db.js `devices` table)
// refills it, and occasional leak events cause a fast unexplained drop for
// the leak-detection logic in routes/tanks.js to catch.

const db = require('./db');

const insertReading = db.prepare(
  'INSERT INTO readings (building_id, reading_type, value, timestamp) VALUES (?, ?, ?, ?)'
);
const latestTankReading = db.prepare(
  `SELECT value FROM readings WHERE building_id = ? AND reading_type = 'tank_level'
   ORDER BY timestamp DESC LIMIT 1`
);
const pumpStatusForBuilding = db.prepare(
  `SELECT status FROM devices WHERE building_id = ? AND device_type = 'pump' LIMIT 1`
);

// Building IDs come from whatever's actually seeded in the DB (now spanning
// two demo customers/portfolios — see db.js), rather than a hardcoded list,
// so adding a customer's buildings doesn't also require editing this file.
function allBuildingIds() {
  return db.prepare('SELECT id FROM buildings ORDER BY id').all().map((r) => r.id);
}

// A couple of buildings run a bit "hotter" than the rest, and one is prone to
// an occasional water leak spike, so the demo has something for the alert
// badges to catch.
// Leak/spike chances are deliberately low — this drives the default,
// unattended dashboard state, and a client demo should open calm (green)
// rather than already mid-incident. Trigger an alert live and on-demand for
// the demo instead: `curl -X POST /api/readings -d '{"building_id":N,
// "reading_type":"tank_level","value":30}'` (see README) drops a tank fast
// enough to trip leak detection immediately, without waiting on chance.
const DEFAULT_PROFILE = { energyBase: 2.2, energyJitter: 0.6, waterBase: 27, waterJitter: 8, leakChance: 0.004 };
const PROFILE = {
  1: { energyBase: 2.0, energyJitter: 0.5, waterBase: 25, waterJitter: 8, leakChance: 0.006 },
  2: { energyBase: 2.2, energyJitter: 0.6, waterBase: 28, waterJitter: 8, leakChance: 0.004 },
  3: { energyBase: 3.4, energyJitter: 0.9, waterBase: 30, waterJitter: 10, leakChance: 0.004 },
  4: { energyBase: 2.1, energyJitter: 0.5, waterBase: 26, waterJitter: 9, leakChance: 0.012 },
  5: { energyBase: 2.3, energyJitter: 0.6, waterBase: 27, waterJitter: 8, leakChance: 0.004 },
  6: { energyBase: 3.0, energyJitter: 0.7, waterBase: 34, waterJitter: 10, leakChance: 0.004 },
  7: { energyBase: 3.1, energyJitter: 0.7, waterBase: 35, waterJitter: 10, leakChance: 0.004 },
  8: { energyBase: 3.6, energyJitter: 0.9, waterBase: 40, waterJitter: 12, leakChance: 0.006 },
};

// Tank simulation: drains a bit every tick (faster while people are around),
// refills once it gets low — but only while that building's pump device is
// "on" — and occasionally springs a fast-draining leak.
const DEFAULT_TANK_PROFILE = { drainMin: 0.2, drainMax: 0.5, refillLowPct: 35, refillTargetPct: 90, leakChance: 0.002, leakDropPerTick: [1.5, 3], leakDurationTicks: [2, 4] };
const TANK_PROFILE = {
  1: { drainMin: 0.15, drainMax: 0.45, refillLowPct: 35, refillTargetPct: 90, leakChance: 0.002, leakDropPerTick: [1.5, 3], leakDurationTicks: [2, 4] },
  2: { drainMin: 0.2, drainMax: 0.5, refillLowPct: 35, refillTargetPct: 90, leakChance: 0.002, leakDropPerTick: [1.5, 3], leakDurationTicks: [2, 4] },
  3: { drainMin: 0.25, drainMax: 0.6, refillLowPct: 35, refillTargetPct: 90, leakChance: 0.0015, leakDropPerTick: [1.5, 3], leakDurationTicks: [2, 4] },
  4: { drainMin: 0.2, drainMax: 0.5, refillLowPct: 35, refillTargetPct: 90, leakChance: 0.006, leakDropPerTick: [2, 4], leakDurationTicks: [2, 5] },
  5: { drainMin: 0.2, drainMax: 0.45, refillLowPct: 35, refillTargetPct: 90, leakChance: 0.002, leakDropPerTick: [1.5, 3], leakDurationTicks: [2, 4] },
  6: { drainMin: 0.3, drainMax: 0.7, refillLowPct: 35, refillTargetPct: 90, leakChance: 0.002, leakDropPerTick: [1.5, 3], leakDurationTicks: [2, 4] },
  7: { drainMin: 0.3, drainMax: 0.7, refillLowPct: 35, refillTargetPct: 90, leakChance: 0.002, leakDropPerTick: [1.5, 3], leakDurationTicks: [2, 4] },
  // Tower C carries the RFP's example 12th-floor tank — slightly leak-prone
  // so the demo has one on this portfolio ready to show off detection too.
  8: { drainMin: 0.35, drainMax: 0.8, refillLowPct: 35, refillTargetPct: 90, leakChance: 0.006, leakDropPerTick: [2, 4], leakDurationTicks: [2, 5] },
};

// In-memory tank state (current level + any leak in progress). Reseeded from
// the last known reading on startup so a server restart doesn't jump the
// gauge — see start().
const tankState = {};

function randomBetween([min, max]) {
  return min + Math.random() * (max - min);
}

function dayCycleMultiplier(hour) {
  // Peaks around 8am and 7pm, quiet overnight — a rough occupancy curve.
  const morning = Math.exp(-((hour - 8) ** 2) / 8);
  const evening = Math.exp(-((hour - 19) ** 2) / 10);
  return 0.4 + morning * 0.9 + evening * 1.1;
}

function generateReading(buildingId, type, atDate) {
  const profile = PROFILE[buildingId] || DEFAULT_PROFILE;
  const hour = atDate.getHours();
  const cycle = dayCycleMultiplier(hour);
  const isLeak = Math.random() < profile.leakChance;

  if (type === 'energy') {
    const value = Math.max(
      0,
      profile.energyBase * cycle + (Math.random() - 0.5) * profile.energyJitter * 2
    );
    return isLeak ? value * 2.5 : value; // faulty equipment spike
  }

  const value = Math.max(
    0,
    profile.waterBase * cycle + (Math.random() - 0.5) * profile.waterJitter * 2
  );
  return isLeak ? value * 3.5 : value; // leak spike
}

function stepTankLevel(buildingId, hour, pumpOn) {
  const profile = TANK_PROFILE[buildingId] || DEFAULT_TANK_PROFILE;
  const state = tankState[buildingId] || (tankState[buildingId] = { level: 75, leakTicksRemaining: 0 });
  const cycle = dayCycleMultiplier(hour);

  if (state.leakTicksRemaining > 0) {
    state.level -= randomBetween(profile.leakDropPerTick);
    state.leakTicksRemaining -= 1;
  } else {
    state.level -= randomBetween([profile.drainMin, profile.drainMax]) * cycle;
    if (Math.random() < profile.leakChance) {
      state.leakTicksRemaining = Math.round(randomBetween(profile.leakDurationTicks));
    }
  }

  // The pump only refills when it's switched on — this is what makes the
  // "activate from a distance" control meaningful in the demo: turn a
  // building's pump off and its tank will run down and stay down.
  if (pumpOn && state.level <= profile.refillLowPct) {
    state.level += randomBetween([2, 4]);
  }

  state.level = Math.min(100, Math.max(0, state.level));
  return state.level;
}

function backfillIfEmpty(hours = 48) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM readings').get();
  if (n > 0) return;

  const buildingIds = allBuildingIds();
  const now = new Date();
  const tx = db.transaction(() => {
    for (let h = hours; h >= 1; h--) {
      const ts = new Date(now.getTime() - h * 60 * 60 * 1000);
      for (const buildingId of buildingIds) {
        insertReading.run(buildingId, 'energy', generateReading(buildingId, 'energy', ts), ts.toISOString());
        insertReading.run(buildingId, 'water', generateReading(buildingId, 'water', ts), ts.toISOString());
        // Historical tank levels: smooth drain/refill cycle, no leak drama —
        // leaks are reserved for the live tick so the demo has a fresh one.
        const level = stepTankLevel(buildingId, ts.getHours(), true);
        tankState[buildingId].leakTicksRemaining = 0;
        insertReading.run(buildingId, 'tank_level', level, ts.toISOString());
      }
    }
  });
  tx(); // eslint-disable-line -- runs the batch insert inside a transaction
  console.log(`Simulator: backfilled ${hours}h of sample readings for ${buildingIds.length} buildings.`);
}

// generateReading() returns an hourly rate (that's what the backfill uses,
// one reading per simulated hour). The live ticker fires much more often
// than hourly, so each tick's reading has to be scaled down to the slice of
// an hour it actually covers — otherwise "today's total" inflates by
// (3600000 / intervalMs)x too fast and every building trips its threshold
// within minutes instead of over a realistic day.
function tick(intervalMs) {
  const now = new Date();
  const hourFraction = intervalMs / (60 * 60 * 1000);
  const tx = db.transaction(() => {
    for (const buildingId of allBuildingIds()) {
      insertReading.run(
        buildingId,
        'energy',
        generateReading(buildingId, 'energy', now) * hourFraction,
        now.toISOString()
      );
      insertReading.run(
        buildingId,
        'water',
        generateReading(buildingId, 'water', now) * hourFraction,
        now.toISOString()
      );

      const pump = pumpStatusForBuilding.get(buildingId);
      const pumpOn = !pump || pump.status === 'on'; // default on if no device row somehow
      const level = stepTankLevel(buildingId, now.getHours(), pumpOn);
      insertReading.run(buildingId, 'tank_level', level, now.toISOString());
    }
  });
  tx();
}

function start({ intervalMs = 30_000 } = {}) {
  backfillIfEmpty();

  // Reseed in-memory tank state from the last persisted reading so a server
  // restart continues from where the gauge actually was.
  for (const buildingId of allBuildingIds()) {
    const row = latestTankReading.get(buildingId);
    tankState[buildingId] = { level: row ? row.value : 75, leakTicksRemaining: 0 };
  }

  tick(intervalMs); // one immediate reading so a fresh DB looks alive right away
  const handle = setInterval(() => tick(intervalMs), intervalMs);
  return () => clearInterval(handle);
}

module.exports = { start, backfillIfEmpty, tick };
