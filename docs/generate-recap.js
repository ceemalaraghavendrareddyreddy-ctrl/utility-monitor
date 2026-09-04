const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, AlignmentType, PageOrientation,
} = require('docx');

const ACCENT = '2563EB';
const HEADER_FILL = 'EFF6FF';
const ALT_FILL = 'F8FAFC';
const OK_FILL = 'F0FDF4';
const WARN_FILL = 'FFFBEB';

function h(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ text, heading: level, spacing: { before: 320, after: 140 } });
}

function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 160 },
  });
}

function bullet(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    bullet: { level: 0 },
    spacing: { after: 80 },
  });
}

function cell(text, { fill, bold, width, color } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: !!bold, color })],
      }),
    ],
  });
}

function statusCell(text, width) {
  const isDone = text.startsWith('Done');
  return cell(text, { width, fill: isDone ? OK_FILL : WARN_FILL });
}

const rfpRows = [
  ['Multi-building tank-level monitoring', 'Done', 'Per-building gauge, % full + litres, configurable low threshold'],
  ['Consumption dashboards (energy + water)', 'Done', 'Per-building cards + 24h trend sparklines, community-wide totals'],
  ['Leak detection / early warning', 'Done', 'Flags an abnormal rate-of-drop in tank level, separate from "running low"'],
  ['Instant alerts to designated personnel', 'Done', 'Automatic email per portfolio when an alert starts; SMS/push are a small extension of the same engine'],
  ['Activate IoT device from a distance', 'Done (simulated)', 'Remote pump on/off from the dashboard; wiring to real hardware needs the BMS/gateway integration below'],
  ['Web portal, multi-user, multi-location', 'Done', 'Login-gated, multiple buildings and multiple customer portfolios, each user locked to their own data'],
  ['Dedicated mobile application', 'Done, as an installable web app', 'Installs to a phone home screen like a native app, at a fraction of native app cost — see "Open questions"'],
  ['Industrial-grade hardware', 'Not started', 'Depends entirely on what the client tells us about their meters/sensors — see "Open questions"'],
];

const architectureRows = [
  ['1. Meter / Sensor', 'Physical energy meter or water tank-level sensor at each building', 'Simulated for the demo; real hardware TBD with client'],
  ['2. Gateway', 'Reads meters/sensors, forwards readings to the platform', 'A defined API endpoint is ready to receive real readings today'],
  ['3. Storage', 'Time-stamped readings per building, retained for history/trends', 'Working — lightweight database, portable to a larger one at scale'],
  ['4. Dashboard', 'Live values, trends, alerts, remote control, multi-portfolio', 'Working — see live demo below'],
];

const openQuestions = [
  'What meter/sensor brand and model is installed (or planned) at each building, and what connectivity does it support — Wi-Fi/vendor API, Modbus/BACnet, or LoRaWAN? This decides the gateway hardware.',
  'Are all buildings on one local network, or physically separate sites? Affects how many gateways are needed and where.',
  'What usage/level thresholds should count as "high usage" or "low tank level" per building?',
  'Who needs access — the client only, or building managers and residents too? This shapes the access-role design.',
  'Is a native App Store/Play Store app a hard requirement, or does an installable web app (already built) satisfy the "mobile application" need?',
  'Rough budget and timeline expectations, to size the hardware + integration proposal appropriately.',
];

const nextSteps = [
  'Confirm meter/sensor make, model, and connectivity per building (drives the gateway hardware choice).',
  'Agree on real usage/low-level thresholds per building.',
  'Scope and quote the physical gateway hardware once connectivity is known.',
  'Connect real readings to the existing platform (the ingestion endpoint is already built and tested).',
  'Move the platform from this demo environment to durable hosting.',
];

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
          children: [new TextRun({ text: 'Multi-Building Water & Energy Monitoring Platform — Prototype Recap', size: 26 })],
          spacing: { after: 40 },
        }),
        new Paragraph({
          children: [new TextRun({ text: 'Prepared for review call · September 2026', size: 20, color: '64707D', italics: true })],
          spacing: { after: 300 },
        }),

        h('Overview', HeadingLevel.HEADING_1),
        p(
          'Following the request for a cost-effective, web- and app-based IoT platform to monitor and remotely activate ' +
          'water and energy infrastructure across multiple buildings, we have built a working prototype covering the ' +
          'full software side of this platform end to end. It is live now and ready to walk through on this call.'
        ),
        p(
          'The remaining piece — physical meters/sensors and the gateway hardware connecting them to this platform — ' +
          'depends on details only the client can confirm (see "Open questions" below), and is the natural next scoping step.'
        ),

        h('Live demo', HeadingLevel.HEADING_1),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2200, 7160],
          rows: [
            new TableRow({ children: [cell('URL', { width: 2200, bold: true, fill: HEADER_FILL }), cell('https://punk-handle-unsubscribe-usr.trycloudflare.com', { width: 7160, color: ACCENT })] }),
            new TableRow({ children: [cell('Login', { width: 2200, bold: true, fill: HEADER_FILL }), cell('Credentials provided separately for the demo accounts', { width: 7160 })] }),
            new TableRow({ children: [cell('Note', { width: 2200, bold: true, fill: HEADER_FILL }), cell('This is a temporary demo link for this call — not the permanent hosting location.', { width: 7160 })] }),
          ],
        }),
        new Paragraph({ text: '', spacing: { after: 200 } }),
        p('Two example portfolios are set up to show the platform serving more than one client from the same system:'),
        bullet('Sunrise Gated Community — 5 buildings, energy + water flow + tank level per building.'),
        bullet('Oceanview Towers — 3 towers, including a 12th-floor tank example, matching the brief’s scenario.'),

        h('Architecture', HeadingLevel.HEADING_1),
        p('Data flows through four stages, from the physical meter through to the screen:'),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [1800, 3600, 3960],
          rows: [
            new TableRow({
              children: [
                cell('Stage', { width: 1800, bold: true, fill: HEADER_FILL }),
                cell('What it does', { width: 3600, bold: true, fill: HEADER_FILL }),
                cell('Status', { width: 3960, bold: true, fill: HEADER_FILL }),
              ],
            }),
            ...architectureRows.map(([stage, does, status]) =>
              new TableRow({ children: [cell(stage, { width: 1800 }), cell(does, { width: 3600 }), cell(status, { width: 3960 })] })
            ),
          ],
        }),

        h('Features delivered vs. request', HeadingLevel.HEADING_1),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [3200, 1700, 4460],
          rows: [
            new TableRow({
              children: [
                cell('Requested', { width: 3200, bold: true, fill: HEADER_FILL }),
                cell('Status', { width: 1700, bold: true, fill: HEADER_FILL }),
                cell('Notes', { width: 4460, bold: true, fill: HEADER_FILL }),
              ],
            }),
            ...rfpRows.map(([req, status, notes]) =>
              new TableRow({ children: [cell(req, { width: 3200 }), statusCell(status, 1700), cell(notes, { width: 4460 })] })
            ),
          ],
        }),

        h('Open questions for this call', HeadingLevel.HEADING_1),
        p('These directly determine the hardware selection and the pricing/scope of the next phase:'),
        ...openQuestions.map((q) => bullet(q)),

        h('Suggested next steps', HeadingLevel.HEADING_1),
        ...nextSteps.map((s, i) => bullet(`${i + 1}. ${s}`)),

        new Paragraph({
          border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'E2E6EA', space: 12 } },
          spacing: { before: 400 },
          children: [],
        }),
        p('Community & Multi-Building Utility Monitor — Prototype Recap', { color: '64707D', size: 18, italics: true }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(__dirname + '/Utility-Monitor-Recap.docx', buf);
  console.log('wrote Utility-Monitor-Recap.docx');
});
