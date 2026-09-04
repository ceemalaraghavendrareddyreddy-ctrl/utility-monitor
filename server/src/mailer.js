// Thin SMTP wrapper for the RFP's "instant alert system". Falls back to
// logging to the console when SMTP isn't configured, so alert detection is
// fully demoable without real credentials — set SMTP_HOST (+ SMTP_PORT,
// SMTP_USER, SMTP_PASS, SMTP_SECURE, ALERT_FROM_EMAIL) to actually send.
const nodemailer = require('nodemailer');

let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === '1',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

const FROM_ADDRESS = process.env.ALERT_FROM_EMAIL || 'alerts@utility-monitor.local';

async function sendAlertEmail({ to, subject, text }) {
  if (!to) return { sent: false, reason: 'no recipient configured for this customer' };

  if (!transporter) {
    console.log(`[mailer] SMTP not configured — would send to ${to}:\n  Subject: ${subject}\n  ${text.replace(/\n/g, '\n  ')}`);
    return { sent: false, reason: 'SMTP not configured (logged instead — see README)' };
  }

  await transporter.sendMail({ from: FROM_ADDRESS, to, subject, text });
  return { sent: true };
}

module.exports = { sendAlertEmail };
