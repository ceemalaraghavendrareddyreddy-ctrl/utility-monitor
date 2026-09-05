// Minimal admin onboarding page: create customers, buildings, and logins
// via the admin-only API (see README "API" table). Deliberately a separate
// static page from index.html rather than a mode inside the customer
// dashboard — this never needs to load for a regular owner login.
const loginScreen = document.getElementById('loginScreen');
const appShell = document.getElementById('appShell');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const usernameLabel = document.getElementById('usernameLabel');

let customers = [];

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    showLogin();
    throw new Error('not authenticated');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${url} -> ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

function showLogin() {
  appShell.hidden = true;
  loginScreen.hidden = false;
}

function showApp() {
  loginScreen.hidden = true;
  appShell.hidden = false;
}

// --- Auth ---------------------------------------------------------------

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
    const me = await res.json();
    if (me.role !== 'admin') {
      loginError.textContent = 'This account is not an admin — sign in with an admin login.';
      loginError.hidden = false;
      await fetch('/api/auth/logout', { method: 'POST' });
      return;
    }
    await startApp(me);
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
  showLogin();
});

async function checkSession() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) return null;
  return res.json();
}

async function startApp(me) {
  usernameLabel.textContent = `${me.username} (admin)`;
  showApp();
  await refreshAll();
}

// --- Customers ------------------------------------------------------------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadCustomers() {
  customers = await fetchJSON('/api/customers');
  document.getElementById('customerRows').innerHTML = customers
    .map((c) => `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.slug)}</td><td>${escapeHtml(c.alertEmail) || '<span class="admin-muted">—</span>'}</td></tr>`)
    .join('');

  for (const select of [document.getElementById('buildingCustomerSelect'), document.getElementById('userCustomerSelect')]) {
    const previous = Number(select.value) || customers[0]?.id;
    select.innerHTML = customers.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    if (previous && customers.some((c) => c.id === previous)) select.value = String(previous);
  }
}

document.getElementById('customerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const statusEl = document.getElementById('customerStatus');
  const name = document.getElementById('customerName').value.trim();
  const slug = document.getElementById('customerSlug').value.trim();
  const alertEmail = document.getElementById('customerAlertEmail').value.trim();

  statusEl.textContent = 'Saving…';
  try {
    await fetchJSON('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slug: slug || undefined, alert_email: alertEmail || undefined }),
    });
    event.target.reset();
    statusEl.textContent = `Added "${name}".`;
    await loadCustomers();
    await loadBuildings();
    await loadUsers();
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

// --- Buildings --------------------------------------------------------

async function loadBuildings() {
  const customerId = Number(document.getElementById('buildingCustomerSelect').value);
  const rowsEl = document.getElementById('buildingRows');
  if (!customerId) {
    rowsEl.innerHTML = '';
    return;
  }
  const buildings = await fetchJSON(`/api/buildings?customer_id=${customerId}`);
  // /api/buildings doesn't return threshold/capacity fields in full (it's
  // the dashboard-facing shape, with today's totals) — fetch full detail by
  // re-reading via a PATCH-shaped view isn't available as a GET-by-id, so
  // this reuses what /api/buildings already gives us (today's totals) and
  // shows thresholds it does return (energy/water); tank fields come from
  // /api/tanks for the same customer.
  const tanks = await fetchJSON(`/api/tanks?customer_id=${customerId}`).catch(() => []);
  const tanksByBuilding = Object.fromEntries(tanks.map((t) => [t.buildingId, t]));

  rowsEl.innerHTML = buildings
    .map((b) => {
      const tank = tanksByBuilding[b.id];
      return `<tr data-building-id="${b.id}">
        <td>${escapeHtml(b.name)}</td>
        <td><input type="number" class="admin-inline-input" data-field="energyThresholdKwh" value="${b.energyThresholdKwh}" step="any" /></td>
        <td><input type="number" class="admin-inline-input" data-field="waterThresholdL" value="${b.waterThresholdL}" step="any" /></td>
        <td><input type="number" class="admin-inline-input" data-field="tankLowThresholdPct" value="${tank?.lowThresholdPct ?? ''}" step="any" /></td>
        <td><input type="number" class="admin-inline-input" data-field="tankCapacityL" value="${tank?.capacityLitres ?? ''}" step="any" /></td>
        <td><button type="button" class="admin-save-btn" data-building-id="${b.id}">Save</button></td>
      </tr>`;
    })
    .join('');
}

document.getElementById('buildingCustomerSelect').addEventListener('change', loadBuildings);

document.getElementById('buildingRows').addEventListener('click', async (event) => {
  const btn = event.target.closest('.admin-save-btn');
  if (!btn) return;
  const buildingId = btn.dataset.buildingId;
  const row = btn.closest('tr');
  const body = {};
  for (const input of row.querySelectorAll('input[data-field]')) {
    if (input.value !== '') body[input.dataset.field] = Number(input.value);
  }
  const statusEl = document.getElementById('buildingStatus');
  statusEl.textContent = 'Saving…';
  try {
    await fetchJSON(`/api/buildings/${buildingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    statusEl.textContent = 'Saved.';
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

document.getElementById('buildingForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const statusEl = document.getElementById('buildingStatus');
  const customerId = Number(document.getElementById('buildingCustomerSelect').value);
  if (!customerId) {
    statusEl.textContent = 'Add a customer first.';
    return;
  }
  const body = {
    customerId,
    name: document.getElementById('buildingName').value.trim(),
  };
  const numericFields = [
    ['buildingEnergyThreshold', 'energyThresholdKwh'],
    ['buildingWaterThreshold', 'waterThresholdL'],
    ['buildingTankLowPct', 'tankLowThresholdPct'],
    ['buildingTankCapacity', 'tankCapacityL'],
  ];
  for (const [inputId, field] of numericFields) {
    const value = document.getElementById(inputId).value;
    if (value !== '') body[field] = Number(value);
  }

  statusEl.textContent = 'Saving…';
  try {
    await fetchJSON('/api/buildings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    event.target.reset();
    statusEl.textContent = `Added "${body.name}".`;
    await loadBuildings();
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

// --- Users --------------------------------------------------------------

async function loadUsers() {
  const customerId = Number(document.getElementById('userCustomerSelect').value);
  const rowsEl = document.getElementById('userRows');
  if (!customerId) {
    rowsEl.innerHTML = '';
    return;
  }
  const [users, buildings] = await Promise.all([
    fetchJSON(`/api/users?customer_id=${customerId}`),
    fetchJSON(`/api/buildings?customer_id=${customerId}`), // for manager rows' "Scope" column
  ]);
  const buildingNameById = Object.fromEntries(buildings.map((b) => [b.id, b.name]));

  rowsEl.innerHTML = users
    .map((u) => {
      const scope = u.role === 'manager' ? escapeHtml(buildingNameById[u.buildingId] || `building #${u.buildingId}`) : 'whole portfolio';
      return `<tr>
        <td>${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.role)}</td>
        <td>${scope}</td>
        <td><button type="button" class="admin-delete-btn" data-user-id="${u.id}">Delete</button></td>
      </tr>`;
    })
    .join('');
}

document.getElementById('userCustomerSelect').addEventListener('change', () => {
  loadUsers();
  loadUserBuildingOptions();
});

// The "manager" role scopes to one building rather than the whole
// customer — populate that select from the customer currently chosen in
// the Logins panel, and only show it when "manager" is the selected role.
async function loadUserBuildingOptions() {
  const select = document.getElementById('userBuildingSelect');
  const customerId = Number(document.getElementById('userCustomerSelect').value);
  if (!customerId) {
    select.innerHTML = '';
    return;
  }
  const buildings = await fetchJSON(`/api/buildings?customer_id=${customerId}`);
  select.innerHTML = buildings.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
}

document.getElementById('userRole').addEventListener('change', (event) => {
  document.getElementById('userBuildingSelect').hidden = event.target.value !== 'manager';
});

document.getElementById('userRows').addEventListener('click', async (event) => {
  const btn = event.target.closest('.admin-delete-btn');
  if (!btn) return;
  if (!confirm('Delete this login? Its active session will be revoked immediately.')) return;
  const statusEl = document.getElementById('userStatus');
  try {
    await fetchJSON(`/api/users/${btn.dataset.userId}`, { method: 'DELETE' });
    statusEl.textContent = 'Deleted.';
    await loadUsers();
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

document.getElementById('userForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const statusEl = document.getElementById('userStatus');
  const customerId = Number(document.getElementById('userCustomerSelect').value);
  const buildingId = Number(document.getElementById('userBuildingSelect').value);
  const username = document.getElementById('userUsername').value.trim();
  const role = document.getElementById('userRole').value;
  if (['owner', 'resident'].includes(role) && !customerId) {
    statusEl.textContent = 'Add a customer first.';
    return;
  }
  if (role === 'manager' && !buildingId) {
    statusEl.textContent = 'Add a building for this customer first.';
    return;
  }

  statusEl.textContent = 'Saving…';
  try {
    const body = { username, role };
    if (['owner', 'resident'].includes(role)) body.customerId = customerId;
    if (role === 'manager') body.buildingId = buildingId;

    const created = await fetchJSON('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    event.target.reset();
    document.getElementById('userBuildingSelect').hidden = true; // reset() doesn't fire the role-change listener
    statusEl.textContent = `Added "${created.username}".`;
    document.getElementById('userPasswordValue').textContent = created.password;
    document.getElementById('userPasswordReveal').hidden = false;
    await loadUsers();
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

document.getElementById('userPasswordDismiss').addEventListener('click', () => {
  document.getElementById('userPasswordValue').textContent = '';
  document.getElementById('userPasswordReveal').hidden = true;
});

// --- Boot -----------------------------------------------------------------

async function refreshAll() {
  await loadCustomers();
  await loadBuildings();
  await loadUsers();
  await loadUserBuildingOptions();
}

(async () => {
  const me = await checkSession();
  if (me && me.role === 'admin') {
    await startApp(me);
  } else {
    showLogin();
  }
})();
