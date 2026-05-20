const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./db');

const router = express.Router();

const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const VALID_STATUSES   = ['open', 'investigating', 'resolved'];

// GET /api/incidents
router.get('/', (req, res) => {
  const db = getDb();
  const { severity, status } = req.query;
  let query = 'SELECT * FROM incidents';
  const params = [];
  const conditions = [];

  if (severity) {
    if (!VALID_SEVERITIES.includes(severity)) {
      return res.status(400).json({ error: 'Invalid severity value' });
    }
    conditions.push('severity = ?');
    params.push(severity);
  }
  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    conditions.push('status = ?');
    params.push(status);
  }
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY created_at DESC';

  const rows = db.prepare(query).all(...params);
  res.json({ count: rows.length, incidents: rows });
});

// GET /api/incidents/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Incident not found' });
  res.json(row);
});

// POST /api/incidents
router.post('/', (req, res) => {
  const { title, severity, description } = req.body;

  if (!title || typeof title !== 'string' || title.trim() === '') {
    return res.status(400).json({ error: 'title is required' });
  }
  if (!severity || !VALID_SEVERITIES.includes(severity)) {
    return res.status(400).json({ error: 'severity must be one of: low, medium, high, critical' });
  }

  const db = getDb();
  const now = new Date().toISOString();
  const id  = uuidv4();

  db.prepare(
    'INSERT INTO incidents (id, title, severity, status, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, title.trim(), severity, 'open', description || null, now, now);

  const created = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
  res.status(201).json(created);
});

// PATCH /api/incidents/:id
router.patch('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Incident not found' });

  const { status } = req.body;
  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'status must be one of: open, investigating, resolved' });
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE incidents SET status = ?, updated_at = ? WHERE id = ?').run(status, now, req.params.id);
  const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /api/incidents/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Incident not found' });

  db.prepare('DELETE FROM incidents WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
