const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle,
} = require('docx');

const ACCENT = '2563EB';
const HEADER_FILL = 'EFF6FF';
const CODE_FILL = 'F1F5F9';

function h(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ text, heading: level, spacing: { before: 320, after: 140 } });
}
function p(text, opts = {}) {
  return new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 160 } });
}
function bullet(text, opts = {}) {
  return new Paragraph({ children: [new TextRun({ text, ...opts })], bullet: { level: 0 }, spacing: { after: 80 } });
}
function numbered(items) {
  return items.map((t, i) => new Paragraph({
    children: [new TextRun({ text: `${i + 1}. ${t}` })],
    spacing: { after: 100 },
  }));
}
function code(text) {
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: CODE_FILL },
    children: [new TextRun({ text, font: 'Consolas', size: 20 })],
    spacing: { after: 160 },
  });
}
function cell(text, { fill, bold, width, color } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: !!bold, color })] })],
  });
}
function row(cells) { return new TableRow({ children: cells }); }

const doc = new Document({
  sections: [
    {
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 900, bottom: 900, left: 1000, right: 1000 } },
      },
      children: [
        new Paragraph({
          children: [new TextRun({ text: 'Utility Monitor', bold: true, size: 44, color: ACCENT })],
          spacing: { after: 40 },
        }),
        new Paragraph({
          children: [new TextRun({ text: 'How It Works — Technical Walkthrough', size: 26 })],
          spacing: { after: 300 },
        }),

        h('Purpose of this document'),
        p(
          'This explains what the platform actually does, piece by piece — the four-stage data flow, what ' +
          'each part of the code is responsible for, and exactly where real hardware would plug in. It is ' +
          'written for anyone who needs to understand the system well enough to demo it, extend it, or hand ' +
          'it to another developer.'
        ),

        h('1. The big picture'),
        p(
          'Data flows through four stages, from a physical meter/sensor to a screen. Today, stages 1–2 are ' +
          'simulated by one file (the "simulator"); stages 3–4 are fully real and running.'
        ),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [1800, 3960, 3600],
          rows: [
            row([cell('Stage', { width: 1800, bold: true, fill: HEADER_FILL }), cell('What it does', { width: 3960, bold: true, fill: HEADER_FILL }), cell('Today', { width: 3600, bold: true, fill: HEADER_FILL })]),
            row([cell('1. Meter/Sensor', { width: 1800 }), cell('Measures energy use, water flow, or tank level at a building', { width: 3960 }), cell('Simulated (simulator.js)', { width: 3600 })]),
            row([cell('2. Gateway', { width: 1800 }), cell('Reads the meter/sensor, sends readings onward', { width: 3960 }), cell('Simulated; real one calls the API below', { width: 3600 })]),
            row([cell('3. Storage', { width: 1800 }), cell('Keeps every reading, timestamped, for history and thresholds', { width: 3960 }), cell('Real — SQLite database', { width: 3600 })]),
            row([cell('4. Dashboard', { width: 1800 }), cell('Shows live values, trends, alerts; lets you control devices', { width: 3960 }), cell('Real — the web app you’ve been using', { width: 3600 })]),
          ],
        }),

        h('2. The seam for real hardware'),
        p(
          'Everything downstream of this one API endpoint is already built and does not change when real ' +
          'meters replace the simulator. A real gateway (a Raspberry Pi, a vendor’s cloud API poller, a ' +
          'LoRaWAN network server webhook — whatever fits the hardware) just needs to call this:'
        ),
        code('POST /api/readings\n{ "building_id": 1, "reading_type": "energy", "value": 2.4 }'),
        p(
          'reading_type is one of energy, water, or tank_level. That single call is the entire integration ' +
          'surface — the dashboard, alerts, and history all work off whatever lands in this table, without ' +
          'caring whether it came from the simulator or a real sensor.'
        ),

        h('3. What’s stored, and where'),
        p('The database (one SQLite file) has six tables:'),
        bullet('customers — one row per client portfolio (e.g. "Sunrise Gated Community")'),
        bullet('users — login accounts; each is tied to one customer (or none, for an admin)'),
        bullet('buildings — one row per building, with its thresholds (usage limits, low-tank %, tank capacity)'),
        bullet('readings — every energy/water/tank_level value ever recorded, timestamped'),
        bullet('devices — controllable hardware (currently one "inlet pump" per building)'),
        bullet('device_commands — an audit log of every remote on/off command issued'),

        h('4. How a login works'),
        ...numbered([
          'You submit username + password to POST /api/auth/login.',
          'The server checks the password against a stored hash (never the plain password itself — see auth.js) using scrypt, a one-way hashing function.',
          'On success, the server creates a session (a random token) and sends it back as an httpOnly cookie — ' +
          'JavaScript on the page can’t read it, which protects it from a common attack (XSS cookie theft).',
          'Every request after that includes the cookie automatically; the server looks up the session to know who you are and which customer’s data you’re allowed to see.',
          'A non-admin’s customer is locked to their session — even if they edit the URL to ask for another customer’s data, the server ignores that and only ever returns their own.',
        ]),

        h('5. How an alert becomes an email'),
        ...numbered([
          'Every 30 seconds, alertEngine.js checks every building’s latest readings against its thresholds.',
          'Four conditions are checked: energy usage over threshold, water usage over threshold, tank level at or below the low-level threshold, and tank level dropping faster than a normal usage pattern could explain (the leak/burst detector).',
          'If a condition just started (it wasn’t true a moment ago), an email is sent to that customer’s configured address, and the system waits at least 30 minutes before sending another for the same issue — so a lingering problem doesn’t flood the inbox.',
          'If no email server is configured, the email is written to the server’s log instead of actually sending — useful for testing without needing real email credentials.',
        ]),

        h('6. How remote device control works'),
        ...numbered([
          'Clicking a pump toggle on the dashboard sends POST /api/devices/:id/command with {"action": "on"} or {"action": "off"}.',
          'The server updates that device’s status in the database and logs the command (who did what, when).',
          'The simulator reads that same status every tick — if a pump is "off", that building’s tank stops refilling, which is why toggling it visibly changes the tank’s behavior.',
          'For real hardware, this is the same seam as the readings endpoint: a real gateway would poll this device’s status (or receive a push) and physically switch the pump relay accordingly.',
        ]),

        h('7. The dashboard itself'),
        bullet('A single-page app — no build step, just HTML/CSS/JavaScript served directly by the server.'),
        bullet('Refreshes its data every 15 seconds automatically.'),
        bullet('Installable as a "PWA" — has a manifest and service worker so it can be added to a phone/desktop home screen and launches like a native app, without needing an app store.'),
        bullet('Responsive — the same page works on a phone screen or a desktop browser.'),

        h('8. Known limitations (by design, for now)'),
        bullet('Login sessions live in memory — restarting the server logs everyone out. Fine for a demo; a real deployment would move this to a shared store (e.g. Redis or a database table).'),
        bullet('The demo database resets its data if server/data/ is deleted — intentional, so the demo can always start from a clean, calm state.'),
        bullet('The public demo URL depends on a tunnel running on one laptop — it goes down if that laptop turns off. A permanent deployment removes this dependency entirely.'),
        bullet('Remote device control is simulated end-to-end but not yet wired to a physical relay — that’s real hardware integration work (see the Scope of Work and Price List documents).'),

        new Paragraph({
          border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'E2E6EA', space: 12 } },
          spacing: { before: 400 },
          children: [],
        }),
        p('Utility Monitor — How It Works', { color: '64707D', size: 18, italics: true }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(__dirname + '/Utility-Monitor-How-It-Works.docx', buf);
  console.log('wrote Utility-Monitor-How-It-Works.docx');
});
