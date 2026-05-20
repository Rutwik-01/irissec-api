const request = require('supertest');
const fs      = require('fs');
const path    = require('path');

// Use a separate test DB and a fixed test API key
process.env.DB_PATH  = path.join(__dirname, '..', 'test.db');
process.env.API_KEY  = 'test-api-key-jest';

const app        = require('../src/app');
const { closeDb } = require('../src/db');

const API_KEY    = process.env.API_KEY;

afterAll(() => {
  closeDb();
  const testDb = process.env.DB_PATH;
  if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
});

// ── Public routes ─────────────────────────────────────────────────────────────
describe('GET /api/health', () => {
  it('returns 200 with status ok (no auth required)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('GET /metrics', () => {
  it('returns 200 with Prometheus format (no auth required)', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });
});

// ── Authentication middleware ─────────────────────────────────────────────────
describe('API Key Authentication', () => {
  it('returns 401 when X-API-Key header is missing', async () => {
    const res = await request(app).get('/api/incidents');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns 403 when X-API-Key is incorrect', async () => {
    const res = await request(app)
      .get('/api/incidents')
      .set('X-API-Key', 'wrong-key');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('returns 200 when X-API-Key is correct', async () => {
    const res = await request(app)
      .get('/api/incidents')
      .set('X-API-Key', API_KEY);
    expect(res.status).toBe(200);
  });
});

// ── Incidents CRUD (all requests include valid API key) ───────────────────────
describe('POST /api/incidents', () => {
  it('creates an incident with valid data', async () => {
    const res = await request(app)
      .post('/api/incidents')
      .set('X-API-Key', API_KEY)
      .send({ title: 'Phishing attack detected', severity: 'high', description: 'User clicked malicious link' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.title).toBe('Phishing attack detected');
    expect(res.body.severity).toBe('high');
    expect(res.body.status).toBe('open');
  });

  it('returns 400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/incidents')
      .set('X-API-Key', API_KEY)
      .send({ severity: 'low' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/);
  });

  it('returns 400 when severity is invalid', async () => {
    const res = await request(app)
      .post('/api/incidents')
      .set('X-API-Key', API_KEY)
      .send({ title: 'Test', severity: 'extreme' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/severity/);
  });
});

describe('GET /api/incidents', () => {
  it('returns a list with count', async () => {
    const res = await request(app)
      .get('/api/incidents')
      .set('X-API-Key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('count');
    expect(Array.isArray(res.body.incidents)).toBe(true);
  });

  it('filters by severity', async () => {
    await request(app)
      .post('/api/incidents')
      .set('X-API-Key', API_KEY)
      .send({ title: 'Low sev test', severity: 'low' });
    const res = await request(app)
      .get('/api/incidents?severity=low')
      .set('X-API-Key', API_KEY);
    expect(res.status).toBe(200);
    res.body.incidents.forEach(i => expect(i.severity).toBe('low'));
  });

  it('returns 400 for invalid severity filter', async () => {
    const res = await request(app)
      .get('/api/incidents?severity=extreme')
      .set('X-API-Key', API_KEY);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/incidents/:id', () => {
  it('returns a specific incident', async () => {
    const created = await request(app)
      .post('/api/incidents')
      .set('X-API-Key', API_KEY)
      .send({ title: 'Get by ID test', severity: 'medium' });
    const res = await request(app)
      .get(`/api/incidents/${created.body.id}`)
      .set('X-API-Key', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/api/incidents/nonexistent-id')
      .set('X-API-Key', API_KEY);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/incidents/:id', () => {
  it('updates status to investigating', async () => {
    const created = await request(app)
      .post('/api/incidents')
      .set('X-API-Key', API_KEY)
      .send({ title: 'Patch test', severity: 'critical' });
    const res = await request(app)
      .patch(`/api/incidents/${created.body.id}`)
      .set('X-API-Key', API_KEY)
      .send({ status: 'investigating' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('investigating');
  });

  it('returns 400 for invalid status', async () => {
    const created = await request(app)
      .post('/api/incidents')
      .set('X-API-Key', API_KEY)
      .send({ title: 'Bad status test', severity: 'low' });
    const res = await request(app)
      .patch(`/api/incidents/${created.body.id}`)
      .set('X-API-Key', API_KEY)
      .send({ status: 'closed' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/incidents/:id', () => {
  it('deletes an existing incident', async () => {
    const created = await request(app)
      .post('/api/incidents')
      .set('X-API-Key', API_KEY)
      .send({ title: 'Delete me', severity: 'low' });
    const res = await request(app)
      .delete(`/api/incidents/${created.body.id}`)
      .set('X-API-Key', API_KEY);
    expect(res.status).toBe(204);
  });

  it('returns 404 when deleting nonexistent incident', async () => {
    const res = await request(app)
      .delete('/api/incidents/does-not-exist')
      .set('X-API-Key', API_KEY);
    expect(res.status).toBe(404);
  });
});

describe('404 fallback', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/unknown-route');
    expect(res.status).toBe(404);
  });
});
