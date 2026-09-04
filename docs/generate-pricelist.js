const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle,
} = require('docx');

const ACCENT = '2563EB';
const HEADER_FILL = 'EFF6FF';
const WARN_FILL = 'FFFBEB';
const TOTAL_FILL = 'EFF6FF';

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
          children: [new TextRun({ text: 'Price List & Remaining Work — Planning Estimate', size: 26 })],
          spacing: { after: 40 },
        }),
        new Paragraph({
          children: [new TextRun({ text: 'Draft for internal planning · September 2026', size: 20, color: '64707D', italics: true })],
          spacing: { after: 200 },
        }),

        new Table({
          width: { size: 9360, type: WidthType.DXA },
          rows: [
            row([cell(
              'IMPORTANT — READ FIRST: Every number in this document is a planning-level estimate based on ' +
              'typical market rates and common hardware price ranges, NOT a vendor-verified quote. Actual ' +
              'hardware pricing must come from real vendor quotes once the client confirms their meter/sensor ' +
              'requirements (see the Scope of Work). Use this to plan and to have an informed conversation — ' +
              'not to commit a firm price to the client yet.',
              { width: 9360, fill: WARN_FILL, bold: true }
            )]),
          ],
        }),

        h('Assumptions used in this estimate'),
        bullet('Currency: USD. Labor priced at a typical freelance/small-shop full-stack + IoT rate of $40–60/hour ($320–480/8-hr day) — adjust every figure below if your actual rate differs.'),
        bullet('Scale: 5–8 buildings in one portfolio (matching what has been built and demoed), a mix of Wi-Fi/vendor-API and Modbus-style connectivity assumed where the client hasn’t specified.'),
        bullet('Hardware prices are typical retail/distributor ranges for common IoT sensors and gateways as of this writing — real prices vary by brand, region, and order volume.'),
        bullet('Does not include your business’s margin/markup — add your own on top of the cost figures before quoting a client.'),

        h('What is already delivered (Phase 0)'),
        p(
          'The full software platform — dashboard, API, database, auth, multi-portfolio support, leak ' +
          'detection, email alerts, remote device control UI, installable web app — is built and demoed. ' +
          'For context, a comparable custom build from scratch typically runs $8,000–$18,000 at the labor ' +
          'rate above (roughly 20–40 developer-days). That cost has already been absorbed getting to this ' +
          'point — nothing further is owed for Phase 0 itself.'
        ),

        h('Remaining work — effort and cost by phase'),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2400, 1800, 2160, 3000],
          rows: [
            row([
              cell('Phase', { width: 2400, bold: true, fill: HEADER_FILL }),
              cell('Effort', { width: 1800, bold: true, fill: HEADER_FILL }),
              cell('Labor cost (est.)', { width: 2160, bold: true, fill: HEADER_FILL }),
              cell('What it covers', { width: 3000, bold: true, fill: HEADER_FILL }),
            ]),
            row([
              cell('1. Discovery', { width: 2400, bold: true }),
              cell('2–4 days', { width: 1800 }),
              cell('$640 – $1,920', { width: 2160 }),
              cell('Calls, site info gathering, confirming hardware/connectivity/thresholds/access needs', { width: 3000 }),
            ]),
            row([
              cell('2. Hardware & gateway setup', { width: 2400, bold: true }),
              cell('3–7 days labor', { width: 1800 }),
              cell('$960 – $3,360 labor\n(+ hardware, see below)', { width: 2160 }),
              cell('Procuring, configuring, and installing the physical gateway(s)', { width: 3000 }),
            ]),
            row([
              cell('3. Live data integration', { width: 2400, bold: true }),
              cell('5–10 days', { width: 1800 }),
              cell('$1,600 – $4,800', { width: 2160 }),
              cell('Connecting real gateway output to the existing, already-tested ingestion API', { width: 3000 }),
            ]),
            row([
              cell('4. Production hardening', { width: 2400, bold: true }),
              cell('10–20 days', { width: 1800 }),
              cell('$3,200 – $9,600', { width: 2160 }),
              cell('Durable hosting/sessions, finer user roles, SMS/push alerts alongside email', { width: 3000 }),
            ]),
            row([
              cell('5. Rollout & handover', { width: 2400, bold: true }),
              cell('3–5 days', { width: 1800 }),
              cell('$960 – $2,400', { width: 2160 }),
              cell('Real-data threshold tuning, training, documentation, support handoff', { width: 3000 }),
            ]),
            row([
              cell('Subtotal (labor only)', { width: 2400, bold: true, fill: TOTAL_FILL }),
              cell('23–46 days', { width: 1800, bold: true, fill: TOTAL_FILL }),
              cell('$7,360 – $22,080', { width: 2160, bold: true, fill: TOTAL_FILL }),
              cell('Phases 1–5, excluding hardware and a native app', { width: 3000, fill: TOTAL_FILL }),
            ]),
          ],
        }),

        h('Hardware cost estimate (per building, typical ranges)'),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [3400, 2980, 2980],
          rows: [
            row([
              cell('Connectivity type', { width: 3400, bold: true, fill: HEADER_FILL }),
              cell('Typical hardware cost', { width: 2980, bold: true, fill: HEADER_FILL }),
              cell('Notes', { width: 2980, bold: true, fill: HEADER_FILL }),
            ]),
            row([cell('Vendor cloud API (meter already smart/connected)', { width: 3400 }), cell('$0 – $50/building', { width: 2980 }), cell('Little to no new hardware; mainly integration labor (Phase 3)', { width: 2980 })]),
            row([cell('Wi-Fi retrofit sensor (tank ultrasonic level, energy pulse meter)', { width: 3400 }), cell('$40 – $120/building', { width: 2980 }), cell('Sensor unit only; needs existing Wi-Fi coverage at the site', { width: 2980 })]),
            row([cell('Modbus/BACnet (needs a local gateway)', { width: 3400 }), cell('$80 – $200/building', { width: 2980 }), cell('Raspberry Pi or similar gateway (~$60–100) + protocol bridge software (free/open-source)', { width: 2980 })]),
            row([cell('LoRaWAN', { width: 3400 }), cell('$60 – $150/building\n+ $150–$400/gateway (shared across nearby buildings)', { width: 2980 }), cell('One gateway can often cover multiple nearby buildings, reducing per-building cost', { width: 2980 })]),
            row([cell('Remote-controllable relay (per pump/valve)', { width: 3400 }), cell('$20 – $60/device', { width: 2980 }), cell('One per controllable device, e.g. the tank inlet pump already in the demo', { width: 2980 })]),
          ],
        }),
        p('For 5–8 buildings, hardware typically lands in the $400–$1,600 range at these unit prices — confirm with real vendor quotes once connectivity is known.'),

        h('Ongoing costs (monthly, after launch)'),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [3400, 2980, 2980],
          rows: [
            row([
              cell('Item', { width: 3400, bold: true, fill: HEADER_FILL }),
              cell('Typical cost', { width: 2980, bold: true, fill: HEADER_FILL }),
              cell('Notes', { width: 2980, bold: true, fill: HEADER_FILL }),
            ]),
            row([cell('Hosting (small VPS/PaaS)', { width: 3400 }), cell('$5 – $25/month', { width: 2980 }), cell('This scale doesn’t need more than a small single instance', { width: 2980 })]),
            row([cell('Email alerts', { width: 3400 }), cell('$0 – $10/month', { width: 2980 }), cell('Low volume; many providers’ free tiers cover this comfortably', { width: 2980 })]),
            row([cell('SMS alerts (optional, e.g. Twilio)', { width: 3400 }), cell('~$0.008 – $0.02/message', { width: 2980 }), cell('Only if SMS is added alongside email in Phase 4', { width: 2980 })]),
            row([cell('Domain name (optional)', { width: 3400 }), cell('$10 – $20/year', { width: 2980 }), cell('For a branded URL instead of a hosting provider’s default one', { width: 2980 })]),
          ],
        }),

        h('If a native mobile app is required'),
        p(
          'Not included above — the installable web app (PWA) already built covers "install to home screen, ' +
          'launch like an app" for most use cases at no extra cost. A true native app (separate iOS + Android ' +
          'builds, app store listings) is a substantially larger scope:'
        ),
        bullet('Development: roughly 15–30 additional days ($4,800 – $14,400 at the same labor rate), depending on how much of the web dashboard’s functionality is reused vs. rebuilt natively.'),
        bullet('Apple Developer Program: $99/year. Google Play Developer: $25 one-time.'),
        bullet('Recommend confirming with the client whether this is a hard requirement before scoping it in.'),

        h('What is required to proceed (checklist)'),
        bullet('From the client: meter/sensor make & connectivity per building, network access confirmation, real thresholds, access/role requirements.'),
        bullet('Hosting account (e.g. a PaaS or small VPS provider) for durable deployment.'),
        bullet('An SMTP provider (or existing email account) for real alert delivery.'),
        bullet('If SMS is wanted: a Twilio (or similar) account.'),
        bullet('If a native app is wanted: Apple Developer and Google Play developer accounts.'),
        bullet('Physical access to each building to install sensors/gateways once hardware is chosen.'),

        new Paragraph({
          border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'E2E6EA', space: 12 } },
          spacing: { before: 400 },
          children: [],
        }),
        p('Utility Monitor — Price List & Remaining Work (Planning Estimate, not a vendor quote)', { color: '64707D', size: 18, italics: true }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(__dirname + '/Utility-Monitor-Price-List.docx', buf);
  console.log('wrote Utility-Monitor-Price-List.docx');
});
