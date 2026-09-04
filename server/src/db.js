const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');

// Readable-but-strong random password for first-run seeding: base32-ish
// alphabet with no ambiguous characters (0/O, 1/l/I), easy to read off a
// deploy log and type into a login form without transcription errors.
function generatePassword(length = 12) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'utility.db'));
db.exec('PRAGMA journal_mode = WAL');

// node:sqlite (DatabaseSync) has no built-in db.transaction() helper like
// better-sqlite3 — this wraps a batch of statements in BEGIN/COMMIT/ROLLBACK.
function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}

// NOTE: this CHECK constraint (and the buildings columns below) only apply
// to a freshly-created database. If you're upgrading a database created
// before tank-level monitoring or the customers layer were added, delete
// server/data/ and let it re-seed — SQLite can't alter a CHECK constraint or
// add a NOT NULL foreign key column on an existing table, and this is still
// demo/prototype data, not something to migrate in place.
db.exec(`
  -- One row per client portfolio. This is the seam that turns "5 buildings
  -- for one community" into "N buildings across M separate clients" — every
  -- building belongs to exactly one customer, and every API list endpoint
  -- takes a customer_id so one client's data is never visible to another's.
  -- There's no login yet (see README "Next steps" — auth), so this is data
  -- isolation, not access control: anyone hitting the API can still pass any
  -- customer_id. Add auth before this is reachable beyond localhost.
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    alert_email TEXT
  );

  -- Login accounts. A NULL customer_id is an admin/ops account that can view
  -- any portfolio (?customer_id= override); every other user is locked to
  -- exactly one customer_id regardless of what a request asks for — see
  -- customerScope.js. Passwords are scrypt-hashed (see auth.js), never
  -- stored in plaintext.
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    username TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'owner')) DEFAULT 'owner'
  );

  CREATE TABLE IF NOT EXISTS buildings (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    name TEXT NOT NULL,
    energy_threshold_kwh REAL NOT NULL DEFAULT 50,
    water_threshold_l REAL NOT NULL DEFAULT 800,
    tank_low_threshold_pct REAL NOT NULL DEFAULT 25,
    tank_capacity_l REAL NOT NULL DEFAULT 10000
  );

  CREATE INDEX IF NOT EXISTS idx_buildings_customer ON buildings (customer_id);

  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL REFERENCES buildings(id),
    reading_type TEXT NOT NULL CHECK (reading_type IN ('energy', 'water', 'tank_level')),
    value REAL NOT NULL,
    timestamp TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_readings_building_time
    ON readings (building_id, reading_type, timestamp);

  -- Remotely controllable IoT devices (pumps, valves, ...). "Activate from a
  -- distance" from the RFP: a device's status is the seam a real BMS/IoT
  -- gateway would read to actually drive hardware; here it also feeds back
  -- into the tank simulator (turning a building's inlet pump off stops that
  -- tank refilling), so the control loop is real end-to-end even though the
  -- hardware underneath is simulated.
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL REFERENCES buildings(id),
    name TEXT NOT NULL,
    device_type TEXT NOT NULL DEFAULT 'pump',
    status TEXT NOT NULL CHECK (status IN ('on', 'off')) DEFAULT 'on',
    updated_at TEXT NOT NULL
  );

  -- Audit trail of remote commands, for "who activated what, when".
  CREATE TABLE IF NOT EXISTS device_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL REFERENCES devices(id),
    action TEXT NOT NULL,
    issued_at TEXT NOT NULL
  );
`);

// Seed two customers once: the original 5-building community, plus a second
// portfolio so the dashboard's customer switcher actually has something to
// switch between and proves data isolation, not just a dropdown with one
// option in it.
const customerCount = db.prepare('SELECT COUNT(*) AS n FROM customers').get().n;
if (customerCount === 0) {
  const insertCustomer = db.prepare('INSERT INTO customers (id, name, slug, alert_email) VALUES (?, ?, ?, ?)');
  const insertBuilding = db.prepare(
    `INSERT INTO buildings
      (id, customer_id, name, energy_threshold_kwh, water_threshold_l, tank_low_threshold_pct, tank_capacity_l)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const seedTx = transaction(() => {
    // @example.com is IANA-reserved for documentation — it never delivers
    // anywhere, so the alert pipeline has a real (non-null) recipient to
    // exercise out of the box without risking an email to a real inbox.
    // Change via PATCH /api/customers/:id { alert_email } to actually receive alerts.
    insertCustomer.run(1, 'Sunrise Gated Community', 'sunrise', 'ops@sunrise.example.com');
    insertCustomer.run(2, 'Oceanview Towers', 'oceanview', 'ops@oceanview.example.com');

    const buildings = [
      { id: 1, customerId: 1, name: 'Building 1', energyThreshold: 55, waterThreshold: 900, tankLowThreshold: 25, tankCapacity: 10000 },
      { id: 2, customerId: 1, name: 'Building 2', energyThreshold: 55, waterThreshold: 900, tankLowThreshold: 25, tankCapacity: 10000 },
      { id: 3, customerId: 1, name: 'Building 3', energyThreshold: 55, waterThreshold: 900, tankLowThreshold: 25, tankCapacity: 12000 },
      { id: 4, customerId: 1, name: 'Building 4', energyThreshold: 55, waterThreshold: 900, tankLowThreshold: 25, tankCapacity: 10000 },
      { id: 5, customerId: 1, name: 'Building 5', energyThreshold: 55, waterThreshold: 900, tankLowThreshold: 25, tankCapacity: 10000 },
      { id: 6, customerId: 2, name: 'Tower A', energyThreshold: 70, waterThreshold: 1100, tankLowThreshold: 25, tankCapacity: 15000 },
      { id: 7, customerId: 2, name: 'Tower B', energyThreshold: 70, waterThreshold: 1100, tankLowThreshold: 25, tankCapacity: 15000 },
      { id: 8, customerId: 2, name: 'Tower C (12th-floor tank)', energyThreshold: 70, waterThreshold: 1100, tankLowThreshold: 25, tankCapacity: 18000 },
    ];
    for (const b of buildings) {
      insertBuilding.run(b.id, b.customerId, b.name, b.energyThreshold, b.waterThreshold, b.tankLowThreshold, b.tankCapacity);
    }
  });
  seedTx();
}

// Seed one inlet pump device per building once.
const deviceCount = db.prepare('SELECT COUNT(*) AS n FROM devices').get().n;
if (deviceCount === 0) {
  const insertDevice = db.prepare(
    `INSERT INTO devices (building_id, name, device_type, status, updated_at) VALUES (?, ?, ?, 'on', ?)`
  );
  const buildingIds = db.prepare('SELECT id FROM buildings ORDER BY id').all().map((r) => r.id);
  const seedTx = transaction(() => {
    const now = new Date().toISOString();
    for (const buildingId of buildingIds) {
      insertDevice.run(buildingId, 'Tank Inlet Pump', 'pump', now);
    }
  });
  seedTx();
}

// Seed demo login accounts once. Passwords are randomly generated per
// deployment (not hardcoded) and printed to the console/logs on first run —
// that's the only place to find them, so check `fly logs` / your host's
// logs (or server stdout locally) right after first start. Set the
// SEED_*_PASSWORD env vars below before first start to pin them instead
// (e.g. for a stable local dev login you don't want to look up every time).
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const insertUser = db.prepare(
    `INSERT INTO users (customer_id, username, password_salt, password_hash, role) VALUES (?, ?, ?, ?, ?)`
  );
  const demoAccounts = [
    { customerId: null, username: 'admin', password: process.env.SEED_ADMIN_PASSWORD || generatePassword(), role: 'admin' },
    { customerId: 1, username: 'sunrise', password: process.env.SEED_SUNRISE_PASSWORD || generatePassword(), role: 'owner' },
    { customerId: 2, username: 'oceanview', password: process.env.SEED_OCEANVIEW_PASSWORD || generatePassword(), role: 'owner' },
  ];
  const seedTx = transaction(() => {
    for (const acc of demoAccounts) {
      const { salt, hash } = hashPassword(acc.password);
      insertUser.run(acc.customerId, acc.username, salt, hash, acc.role);
    }
  });
  seedTx();
  console.log('Seeded demo login accounts (username / password):');
  for (const acc of demoAccounts) console.log(`  ${acc.username} / ${acc.password} (${acc.role})`);
  console.log('These are randomly generated each fresh boot — save them, they will not be shown again.');
}

module.exports = db;
module.exports.transaction = transaction;
