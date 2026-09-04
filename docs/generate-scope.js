const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle,
} = require('docx');

const ACCENT = '2563EB';
const HEADER_FILL = 'EFF6FF';
const IN_FILL = 'F0FDF4';
const OUT_FILL = 'FEF2F2';
const TBD_FILL = 'FFFBEB';

function h(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ text, heading: level, spacing: { before: 320, after: 140 } });
}

function p(text, opts = {}) {
  return new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 160 } });
}

function bullet(text, opts = {}) {
  return new Paragraph({ children: [new TextRun({ text, ...opts })], bullet: { level: 0 }, spacing: { after: 80 } });
}

function cell(text, { fill, bold, width, color, italics } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: !!bold, color, italics: !!italics })] })],
  });
}

function row(cells) {
  return new TableRow({ children: cells });
}

// --- Phase table -----------------------------------------------------------

const phases = [
  {
    name: 'Phase 0 — Software Platform',
    status: 'Complete',
    fill: IN_FILL,
    detail:
      'Working web dashboard, backend API, database, simulator, alerting, and multi-portfolio ' +
      'access — demonstrated live on this call. See the accompanying Prototype Recap for the full ' +
      'feature list against the original request.',
  },
  {
    name: 'Phase 1 — Hardware & Connectivity Discovery',
    status: 'Not started — needs client input',
    fill: TBD_FILL,
    detail:
      'Confirm meter/sensor make, model, and connectivity per building (Wi-Fi/vendor API, Modbus/BACnet, ' +
      'or LoRaWAN); confirm network layout across buildings; agree real usage/low-level thresholds; ' +
      'confirm who needs access and at what permission level.',
  },
  {
    name: 'Phase 2 — Hardware Procurement & Gateway Setup',
    status: 'Depends on Phase 1',
    fill: TBD_FILL,
    detail:
      'Source and install the physical gateway(s) (e.g. Raspberry Pi + Node-RED/Home Assistant, or a ' +
      'LoRaWAN gateway) appropriate to the connectivity confirmed in Phase 1. Pricing and lead time ' +
      'depend entirely on what is chosen here.',
  },
  {
    name: 'Phase 3 — Live Data Integration',
    status: 'Platform-side ready now',
    fill: IN_FILL,
    detail:
      'Connect real gateway readings to the existing ingestion endpoint, replacing simulated data. The ' +
      'receiving side of this (the API) is already built and tested — this phase is primarily gateway-side work.',
  },
  {
    name: 'Phase 4 — Production Hardening',
    status: 'Scoped, not started',
    fill: TBD_FILL,
    detail:
      'Durable hosting (beyond the demo environment), durable login sessions, finer-grained user roles ' +
      'if needed, SMS/push alerts alongside email, and a native mobile app if the client specifically ' +
      'requires App Store/Play Store presence over the installable web app already built.',
  },
  {
    name: 'Phase 5 — Rollout & Handover',
    status: 'Not started',
    fill: TBD_FILL,
    detail: 'Threshold tuning against real data, user training/handover, documentation, support transition.',
  },
];

// --- In / out of scope -------------------------------------------------------

const inScope = [
  'Web dashboard: per-building energy, water-flow, and tank-level monitoring with live updates',
  'Trend history (sparklines) and configurable usage/low-level thresholds per building',
  'Automatic leak/burst detection based on abnormal tank-level drop rate',
  'Automatic email alerts to a designated contact per customer portfolio when an alert starts',
  'Remote device control (e.g. tank inlet pump on/off) from the dashboard',
  'Multi-building and multi-customer portfolio support, with each user restricted to their own data',
  'Login-based access control',
  'Installable web app (PWA) — home-screen install, app-like launch, on phone or desktop',
  'A defined, tested API endpoint ready to receive real meter/sensor readings from a gateway',
];

const outOfScope = [
  'Physical meters, sensors, or gateway hardware (selection and cost depend on Phase 1 discovery)',
  'Installation/wiring of physical hardware at building sites',
  'Ongoing hardware maintenance, firmware updates, or vendor support contracts',
  'Native App Store / Play Store mobile app (unless specifically requested — see Phase 4)',
  'SMS or push notification delivery (email is built; SMS/push are a Phase 4 addition)',
  'Data migration from any existing monitoring system, if one exists',
  'Ongoing hosting costs beyond the initial deployment (billed separately based on chosen host)',
];

const clientResponsibilities = [
  'Provide meter/sensor make, model, and connectivity details per building',
  'Provide (or approve procurement of) network/internet access at each building for the gateway',
  'Confirm real usage and low-tank-level thresholds per building',
  'Confirm who needs dashboard access and at what level (owner, building manager, resident)',
  'Provide timely feedback during Phase 1 discovery, since it blocks Phases 2 onward',
  'Approve budget for physical hardware once Phase 1 defines what is needed',
];

const assumptions = [
  'Pricing for Phases 1–5 will be issued as a separate quote once Phase 1 discovery answers are known — ' +
  'hardware cost varies significantly by connectivity type and building count.',
  'This scope assumes buildings covered are those discussed on this call; additional buildings/sites ' +
  'can be added under a change order.',
  'The current demo environment is temporary; a durable hosting decision is part of Phase 4.',
  'Where the client already has usable network infrastructure at a building, gateway cost is reduced ' +
  'accordingly.',
];

// --- Document ----------------------------------------------------------------

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
          children: [new TextRun({ text: 'Scope of Work — Multi-Building Water & Energy Monitoring Platform', size: 26 })],
          spacing: { after: 40 },
        }),
        new Paragraph({
          children: [new TextRun({ text: 'Draft for discussion · September 2026', size: 20, color: '64707D', italics: true })],
          spacing: { after: 300 },
        }),

        h('Purpose'),
        p(
          'This document defines the scope of work for delivering a complete IoT water and energy monitoring ' +
          'platform across the client’s buildings, following the initial request for a cost-effective, ' +
          'web- and app-based system with remote device activation. It separates what is already built and ' +
          'demonstrated (the software platform) from what remains and depends on information only the ' +
          'client can provide (physical hardware and connectivity).'
        ),

        h('Project phases'),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2600, 2200, 4560],
          rows: [
            row([
              cell('Phase', { width: 2600, bold: true, fill: HEADER_FILL }),
              cell('Status', { width: 2200, bold: true, fill: HEADER_FILL }),
              cell('Covers', { width: 4560, bold: true, fill: HEADER_FILL }),
            ]),
            ...phases.map((ph) =>
              row([
                cell(ph.name, { width: 2600, bold: true }),
                cell(ph.status, { width: 2200, fill: ph.fill }),
                cell(ph.detail, { width: 4560 }),
              ])
            ),
          ],
        }),

        h('In scope'),
        p('Delivered and demonstrated as part of the software platform:'),
        ...inScope.map((s) => bullet(s)),

        h('Out of scope'),
        p('Explicitly not covered by the work completed to date, and not included until scoped/quoted separately:'),
        ...outOfScope.map((s) => bullet(s)),

        h('Client responsibilities'),
        p('The following are needed from the client for Phase 1 onward to proceed:'),
        ...clientResponsibilities.map((s) => bullet(s)),

        h('Assumptions'),
        ...assumptions.map((s) => bullet(s)),

        h('Timeline & pricing'),
        p(
          'Phase 0 (software platform) is complete at no further cost to reach this point. Timeline and ' +
          'pricing for Phases 1 through 5 depend directly on the hardware/connectivity answers gathered in ' +
          'Phase 1, and will be issued as a firm quote once that discovery is complete. As a rough shape:'
        ),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [3400, 2980, 2980],
          rows: [
            row([
              cell('Phase', { width: 3400, bold: true, fill: HEADER_FILL }),
              cell('Timeline', { width: 2980, bold: true, fill: HEADER_FILL }),
              cell('Pricing', { width: 2980, bold: true, fill: HEADER_FILL }),
            ]),
            row([cell('Phase 0 — Software platform', { width: 3400 }), cell('Complete', { width: 2980 }), cell('Complete', { width: 2980 })]),
            row([cell('Phase 1 — Discovery', { width: 3400 }), cell('TBD — pending call', { width: 2980, italics: true }), cell('TBD', { width: 2980, italics: true })]),
            row([cell('Phase 2 — Hardware & gateway', { width: 3400 }), cell('TBD — depends on Phase 1', { width: 2980, italics: true }), cell('TBD', { width: 2980, italics: true })]),
            row([cell('Phase 3 — Live integration', { width: 3400 }), cell('TBD', { width: 2980, italics: true }), cell('TBD', { width: 2980, italics: true })]),
            row([cell('Phase 4 — Production hardening', { width: 3400 }), cell('TBD', { width: 2980, italics: true }), cell('TBD', { width: 2980, italics: true })]),
            row([cell('Phase 5 — Rollout & handover', { width: 3400 }), cell('TBD', { width: 2980, italics: true }), cell('TBD', { width: 2980, italics: true })]),
          ],
        }),

        h('Change management'),
        p(
          'Any work outside the "In scope" section above — additional buildings, additional portfolios, ' +
          'native mobile app development, or features not listed — will be handled as a separate change ' +
          'order with its own timeline and pricing, agreed in writing before work begins.'
        ),

        new Paragraph({
          border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'E2E6EA', space: 12 } },
          spacing: { before: 400 },
          children: [],
        }),
        p('Utility Monitor — Scope of Work (Draft)', { color: '64707D', size: 18, italics: true }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(__dirname + '/Utility-Monitor-Scope-of-Work.docx', buf);
  console.log('wrote Utility-Monitor-Scope-of-Work.docx');
});
