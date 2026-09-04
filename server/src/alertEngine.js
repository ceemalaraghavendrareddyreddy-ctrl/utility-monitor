// Watches every building for the same conditions routes/tanks.js and
// routes/summary.js surface as badges, and emails that building's customer
// contact when one STARTS — the RFP's "instant alert system", not just an
// in-dashboard badge. Edge-triggered with a cooldown so a lingering issue
// emails once, not every 30 seconds it stays true.
const db = require('./db');
const { sendAlertEmail } = require('./mailer');

const LEAK_RATE_PCT_PER_MIN = 2; // keep in sync with routes/tanks.js, routes/summary.js
const RENOTIFY_COOLDOWN_MS = 30 * 60 * 1000; // re-alert at most every 30 min while still active

const lastNotifiedAt = new Map(); // `${buildingId}:${alertType}` -> ms timestamp

function evaluateBuilding(building, todayStartISO) {
  const totals = db
    .prepare(
      `SELECT reading_type, COALESCE(SUM(value), 0) AS total FROM readings
       WHERE building_id = ? AND timestamp >= ? AND reading_type IN ('energy', 'water')
       GROUP BY reading_type`
    )
    .all(building.id, todayStartISO);
  const energyToday = totals.find((t) => t.reading_type === 'energy')?.total || 0;
  const waterToday = totals.find((t) => t.reading_type === 'water')?.total || 0;

  const [latest, prev] = db
    .prepare(
      `SELECT value, timestamp FROM readings
       WHERE building_id = ? AND reading_type = 'tank_level'
       ORDER BY timestamp DESC LIMIT 2`
    )
    .all(building.id);

  let leak = false;
  if (latest && prev) {
    const minutesElapsed = (new Date(latest.timestamp) - new Date(prev.timestamp)) / 60000;
    if (minutesElapsed > 0) leak = (prev.value - latest.value) / minutesElapsed >= LEAK_RATE_PCT_PER_MIN;
  }

  return {
    energy: energyToday >= building.energy_threshold_kwh,
    water: waterToday >= building.water_threshold_l,
    tankLow: latest ? latest.value <= building.tank_low_threshold_pct : false,
    leak,
    levelPct: latest ? latest.value : null,
  };
}

async function checkAndNotify() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartISO = todayStart.toISOString();

  const customers = db.prepare('SELECT * FROM customers').all();
  for (const customer of customers) {
    const buildings = db.prepare('SELECT * FROM buildings WHERE customer_id = ?').all(customer.id);

    for (const building of buildings) {
      const status = evaluateBuilding(building, todayStartISO);
      const checks = [
        ['energy', status.energy, `High energy usage at ${building.name}`, `Energy usage today has crossed the ${building.energy_threshold_kwh} kWh threshold.`],
        ['water', status.water, `High water usage at ${building.name}`, `Water usage today has crossed the ${building.water_threshold_l} L threshold.`],
        ['tankLow', status.tankLow, `Low tank level at ${building.name}`, `Tank level has dropped to or below ${building.tank_low_threshold_pct}%${status.levelPct !== null ? ` (currently ${status.levelPct.toFixed(1)}%)` : ''}.`],
        ['leak', status.leak, `Possible leak at ${building.name}`, `Tank level is dropping faster than normal usage would explain — possible leak or burst.`],
      ];

      for (const [type, isActive, subject, body] of checks) {
        const key = `${building.id}:${type}`;
        if (!isActive) {
          lastNotifiedAt.delete(key); // reset so the next occurrence notifies right away
          continue;
        }

        const last = lastNotifiedAt.get(key);
        if (last && Date.now() - last < RENOTIFY_COOLDOWN_MS) continue;

        lastNotifiedAt.set(key, Date.now());
        const result = await sendAlertEmail({
          to: customer.alert_email,
          subject: `[Utility Monitor] ${subject}`,
          text: `${body}\n\nPortfolio: ${customer.name}\nBuilding: ${building.name}\nTime: ${new Date().toISOString()}`,
        });
        console.log(`[alerts] ${customer.slug}/${key} -> ${result.sent ? 'emailed' : 'not sent: ' + result.reason}`);
      }
    }
  }
}

function start({ intervalMs = 30_000 } = {}) {
  checkAndNotify().catch((err) => console.error('[alerts] check failed', err));
  const handle = setInterval(() => {
    checkAndNotify().catch((err) => console.error('[alerts] check failed', err));
  }, intervalMs);
  return () => clearInterval(handle);
}

module.exports = { start, checkAndNotify };
