const express = require('express');
const client  = require('prom-client');

const apiKeyAuth      = require('./middleware/auth');
const incidentsRouter = require('./incidents');

const app = express();
app.use(express.json());

// ── Prometheus metrics ────────────────────────────────────────────────────────
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpDurationHistogram = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2],
  registers: [register],
});

// Middleware: record metrics for every request
app.use((req, res, next) => {
  const end = httpDurationHistogram.startTimer({ method: req.method, route: req.path });
  res.on('finish', () => {
    httpRequestCounter.inc({ method: req.method, route: req.path, status_code: res.statusCode });
    end();
  });
  next();
});

// ── Public routes (no auth required) ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: process.env.APP_VERSION || '1.0.0',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ── Protected routes (API key required) ──────────────────────────────────────
app.use('/api/incidents', apiKeyAuth, incidentsRouter);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

module.exports = app;
