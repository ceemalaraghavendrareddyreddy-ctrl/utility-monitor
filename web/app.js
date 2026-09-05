const REFRESH_MS = 15_000;
const grid = document.getElementById('buildingGrid');
const statusEl = document.getElementById('status');
const customerSelect = document.getElementById('customerSelect');
const loginScreen = document.getElementById('loginScreen');
const appShell = document.getElementById('appShell');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const usernameLabel = document.getElementById('usernameLabel');
const alertEmailInput = document.getElementById('alertEmailInput');
const alertEmailStatus = document.getElementById('alertEmailStatus');

// Which customer/portfolio is currently shown. Persisted per-browser so
// reloading (or reopening the installed PWA) keeps your last selection —
// this is a per-viewer convenience only, not shared or synced anywhere. A
// non-admin account only ever has one customer anyway (the API enforces
// that), so this mostly matters for the admin demo account.
let currentCustomerId = null;
try {
  currentCustomerId = Number(localStorage.getItem('customerId')) || null;
} catch {
  // localStorage can throw in some contexts (private browsing, blocked
  // storage) — fall back to no persisted selection.
}

let customersById = {};
let refreshTimer = null;
// Set from /api/auth/me on login — governs what this session may see/do:
// 'resident' is read-only (no alert-email field, no device toggle); a
// 'manager' is scoped to one building server-side already, but also
// doesn't manage the portfolio-wide alert-email setting (that's
// admin/owner only) — see routes/customers.js.
let currentRole = null;

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    showLogin();
    throw new Error('not authenticated');
  }
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

// --- Auth -------------------------------------------------------------

function showLogin() {
  if (refreshTimer) clearInterval(refreshTimer);
  appShell.hidden = true;
  loginScreen.hidden = false;
}

function showApp() {
  loginScreen.hidden = true;
  appShell.hidden = false;
}

async function checkSession() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) return null;
  return res.json();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      loginError.textContent = body.error || 'Sign-in failed';
      loginError.hidden = false;
      return;
    }
    await startApp();
  } catch (err) {
    console.error(err);
    loginError.textContent = 'Could not reach the server';
    loginError.hidden = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (err) {
    console.error(err);
  }
  currentCustomerId = null;
  showLogin();
});

// --- Portfolio switcher -------------------------------------------------

async function loadCustomers() {
  const customers = await fetchJSON('/api/customers');
  customersById = Object.fromEntries(customers.map((c) => [c.id, c]));

  if (!currentCustomerId || !customersById[currentCustomerId]) {
    currentCustomerId = customers[0]?.id ?? null;
  }

  customerSelect.innerHTML = customers
    .map((c) => `<option value="${c.id}" ${c.id === currentCustomerId ? 'selected' : ''}>${c.name}</option>`)
    .join('');
  // Only admins have more than one option — a regular user's dropdown is
  // technically functional but pointless with one entry, so hide it.
  customerSelect.style.display = customers.length > 1 ? '' : 'none';

  updateAlertEmailField();
}

function updateAlertEmailField() {
  const customer = customersById[currentCustomerId];
  alertEmailInput.value = customer?.alertEmail || '';
  alertEmailStatus.textContent = '';
}

customerSelect.addEventListener('change', () => {
  currentCustomerId = Number(customerSelect.value);
  try {
    localStorage.setItem('customerId', String(currentCustomerId));
  } catch {
    // ignore — persistence is best-effort only
  }
  updateAlertEmailField();
  refresh();
});

document.getElementById('alertEmailSave').addEventListener('click', async () => {
  alertEmailStatus.textContent = 'Saving…';
  try {
    await fetchJSON(`/api/customers/${currentCustomerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert_email: alertEmailInput.value.trim() || null }),
    });
    if (customersById[currentCustomerId]) {
      customersById[currentCustomerId].alertEmail = alertEmailInput.value.trim() || null;
    }
    alertEmailStatus.textContent = 'Saved';
    setTimeout(() => (alertEmailStatus.textContent = ''), 2000);
  } catch (err) {
    console.error(err);
    alertEmailStatus.textContent = 'Failed to save';
  }
});

// --- Dashboard rendering -------------------------------------------------

function sparklinePath(values, width = 100, height = 36) {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function sparklineSvg(values, color) {
  const path = sparklinePath(values);
  if (!path) return '<svg viewBox="0 0 100 36"></svg>';
  return `<svg viewBox="0 0 100 36" preserveAspectRatio="none">
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" />
  </svg>`;
}

function metricBlock(label, dotClass, value, unit, over) {
  return `
    <div class="metric ${over ? 'over' : ''}">
      <span class="metric-label"><span class="dot ${dotClass}"></span>${label}</span>
      <div class="metric-value">${value.toFixed(1)} <span style="font-size:0.7rem;color:var(--muted)">${unit}</span></div>
    </div>`;
}

function tankGaugeColor(pct, lowThreshold) {
  if (pct <= lowThreshold) return 'var(--tank-low)';
  if (pct <= lowThreshold * 2) return 'var(--tank-mid)';
  return 'var(--tank-ok)';
}

function tankBlock(tank) {
  if (!tank || tank.levelPct === null) {
    return '<div class="tank-block"><span class="metric-label">Tank level</span><div class="metric-value">–</div></div>';
  }
  const color = tankGaugeColor(tank.levelPct, tank.lowThresholdPct);
  const badges = [
    tank.lowLevelAlert ? '<span class="badge badge-tank">Low level</span>' : '',
    tank.leakAlert ? '<span class="badge badge-tank">Leak detected</span>' : '',
  ].join('');

  return `
    <div class="tank-block">
      <div class="tank-header">
        <span class="metric-label">Tank level</span>
        ${badges}
      </div>
      <div class="tank-gauge">
        <div class="tank-gauge-fill" style="width:${tank.levelPct}%; background:${color}"></div>
      </div>
      <div class="tank-readout">
        <strong>${tank.levelPct.toFixed(0)}%</strong>
        <span>${tank.levelLitres.toLocaleString()} / ${tank.capacityLitres.toLocaleString()} L</span>
      </div>
    </div>`;
}

function deviceBlock(device) {
  if (!device) return '';
  const isOn = device.status === 'on';
  const nextAction = isOn ? 'off' : 'on';
  // A resident's session is read-only server-side (POST /api/devices/:id/command
  // 403s for them regardless) — show the status without a clickable control
  // rather than offering a button that will always fail.
  if (currentRole === 'resident') {
    return `
      <div class="device-row">
        <span class="device-name">${device.name}</span>
        <span class="device-toggle ${isOn ? 'on' : 'off'}" aria-label="${isOn ? 'on' : 'off'}">${isOn ? 'ON' : 'OFF'}</span>
      </div>`;
  }
  return `
    <div class="device-row">
      <span class="device-name">${device.name}</span>
      <button
        class="device-toggle ${isOn ? 'on' : 'off'}"
        data-device-id="${device.id}"
        data-action="${nextAction}"
      >${isOn ? 'ON — tap to switch off' : 'OFF — tap to switch on'}</button>
    </div>`;
}

function buildingCard(building, energyHistory, waterHistory, tank, device) {
  const hasAlert = building.energyAlert || building.waterAlert || (tank && (tank.lowLevelAlert || tank.leakAlert));
  return `
    <article class="card ${hasAlert ? 'has-alert' : ''}">
      <div class="card-header">
        <h2>${building.name}</h2>
        ${hasAlert ? '<span class="badge">Attention</span>' : ''}
      </div>
      <div class="metric-row">
        ${metricBlock('Energy today', 'energy', building.energyTodayKwh, 'kWh', building.energyAlert)}
        ${metricBlock('Water today', 'water', building.waterTodayL, 'L', building.waterAlert)}
      </div>
      <div class="sparkline-row">
        ${sparklineSvg(energyHistory, 'var(--energy)')}
        ${sparklineSvg(waterHistory, 'var(--water)')}
      </div>
      ${tankBlock(tank)}
      ${deviceBlock(device)}
    </article>`;
}

async function loadHistory(buildingId, type) {
  const rows = await fetchJSON(`/api/readings?building_id=${buildingId}&type=${type}&hours=24`);
  return rows.map((r) => r.value);
}

async function sendDeviceCommand(deviceId, action) {
  await fetchJSON(`/api/devices/${deviceId}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
}

async function refresh() {
  if (!currentCustomerId) return; // customers haven't loaded yet
  const cid = currentCustomerId;
  try {
    const [summary, buildings, tanks, devices] = await Promise.all([
      fetchJSON(`/api/summary?customer_id=${cid}`),
      fetchJSON(`/api/buildings?customer_id=${cid}`),
      fetchJSON(`/api/tanks?customer_id=${cid}`),
      fetchJSON(`/api/devices?customer_id=${cid}`),
    ]);

    // The portfolio may have been switched again while these requests were
    // in flight — drop a stale response instead of rendering it.
    if (cid !== currentCustomerId) return;

    document.getElementById('totalEnergy').textContent = summary.energyTodayKwh.toFixed(1);
    document.getElementById('totalWater').textContent = summary.waterTodayL.toFixed(0);
    document.getElementById('totalAlerts').textContent = summary.alertCount;
    document.getElementById('alertCard').classList.toggle('has-alerts', summary.alertCount > 0);

    const tankByBuilding = Object.fromEntries(tanks.map((t) => [t.buildingId, t]));
    const deviceByBuilding = Object.fromEntries(devices.map((d) => [d.buildingId, d]));

    const histories = await Promise.all(
      buildings.map((b) =>
        Promise.all([loadHistory(b.id, 'energy'), loadHistory(b.id, 'water')])
      )
    );

    grid.innerHTML = buildings
      .map((b, i) =>
        buildingCard(b, histories[i][0], histories[i][1], tankByBuilding[b.id], deviceByBuilding[b.id])
      )
      .join('');

    statusEl.textContent = `Live · updated ${new Date().toLocaleTimeString()}`;
    statusEl.classList.remove('offline');
  } catch (err) {
    console.error(err);
    if (!loginScreen.hidden) return; // fetchJSON already redirected to login
    statusEl.textContent = 'Offline — retrying…';
    statusEl.classList.add('offline');
  }
}

// Event delegation — the grid's innerHTML is fully replaced on every
// refresh, so listeners are attached once here rather than per-button.
grid.addEventListener('click', async (event) => {
  const button = event.target.closest('.device-toggle');
  if (!button) return;

  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    await sendDeviceCommand(button.dataset.deviceId, button.dataset.action);
    await refresh();
  } catch (err) {
    console.error(err);
    button.disabled = false;
  }
});

async function startApp() {
  const session = await checkSession();
  if (!session) {
    showLogin();
    return;
  }

  showApp();
  currentRole = session.role;
  const roleSuffix =
    session.role === 'admin'
      ? ' (admin)'
      : session.role === 'manager'
        ? ` (manager — ${session.buildingName || 'one building'})`
        : session.role === 'resident'
          ? ' (read-only)'
          : '';
  usernameLabel.textContent = `${session.username}${roleSuffix}`;
  document.getElementById('adminLink').hidden = session.role !== 'admin';
  // Alert-email is a portfolio-wide setting — only admin/owner manage it;
  // a manager is scoped to one building, a resident is read-only.
  document.getElementById('alertSettings').hidden = !['admin', 'owner'].includes(session.role);

  try {
    await loadCustomers();
  } catch (err) {
    console.error('Failed to load customer list', err);
    return; // fetchJSON already handled a 401 by showing the login screen
  }

  refresh();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refresh, REFRESH_MS);
}

startApp();

// --- PWA: service worker + install prompt ---------------------------------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.error('SW registration failed', err));
  });
}

let deferredInstallPrompt = null;
const installBtn = document.getElementById('installBtn');

// Chrome/Edge/Android fire this when the page qualifies as installable;
// Safari/iOS never fires it (there's no programmatic install prompt there —
// users add via Share → Add to Home Screen, which the manifest + icons above
// already support).
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installBtn.hidden = false;
});

installBtn?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  installBtn.hidden = true;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
});

window.addEventListener('appinstalled', () => {
  installBtn.hidden = true;
});
