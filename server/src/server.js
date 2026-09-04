const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRouter = require('./routes/auth');
const customersRouter = require('./routes/customers');
const buildingsRouter = require('./routes/buildings');
const readingsRouter = require('./routes/readings');
const summaryRouter = require('./routes/summary');
const tanksRouter = require('./routes/tanks');
const devicesRouter = require('./routes/devices');
const { requireAuth } = require('./authMiddleware');
const simulator = require('./simulator');
const alertEngine = require('./alertEngine');

const PORT = process.env.PORT || 3000;
// Set DEMO_MODE=0 once real meters/gateway are feeding /api/readings, so the
// simulator stops generating synthetic data alongside real readings.
const DEMO_MODE = process.env.DEMO_MODE !== '0';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRouter);

// Everything below requires a logged-in session. /api/readings handles its
// own auth per-route (GET needs a session, POST needs an ingest API key —
// see routes/readings.js), so it's mounted without this blanket guard.
app.use('/api/customers', requireAuth, customersRouter);
app.use('/api/buildings', requireAuth, buildingsRouter);
app.use('/api/summary', requireAuth, summaryRouter);
app.use('/api/tanks', requireAuth, tanksRouter);
app.use('/api/devices', requireAuth, devicesRouter);
app.use('/api/readings', readingsRouter);

// Serve the dashboard frontend
app.use(express.static(path.join(__dirname, '..', '..', 'web')));

app.listen(PORT, () => {
  console.log(`Utility monitoring server listening on http://localhost:${PORT}`);
  if (DEMO_MODE) {
    simulator.start();
    console.log('Demo mode: simulating meter readings every 30s. Set DEMO_MODE=0 to disable once real meters are connected.');
  }
  alertEngine.start();
});
