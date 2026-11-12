'use strict';
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors    = require('cors');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const XLSX    = require('xlsx');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── DB Pool (PostgreSQL / Supabase) ──────────────────────────────────────────
const connectionString = process.env.DATABASE_URL;
const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }
    })
  : new Pool({
      host    : process.env.DB_HOST     || 'localhost',
      user    : process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME     || 'postgres',
      port    : parseInt(process.env.DB_PORT || '5432', 10),
      ssl     : process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    });

// ─── Constants & Credentials ───────────────────────────────────────────────
const OWNER_USERNAME     = process.env.OWNER_USERNAME     || 'owner';
const OWNER_PASSWORD     = process.env.OWNER_PASSWORD     || process.env.OWNER_PIN || 'owner123';

const ASSISTANT_USERNAME = process.env.ASSISTANT_USERNAME || 'assistant';
const ASSISTANT_PASSWORD = process.env.ASSISTANT_PASSWORD || process.env.ASSISTANT_PIN || 'site123';

const TOKEN_SECRET       = process.env.TOKEN_SECRET       || 'contractflow_enterprise_secret_2026';
const TOKEN_TTL          = 86400000; // 24 h

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ─── Serve Homepage ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const p1 = path.join(__dirname, 'index.html');
  if (fs.existsSync(p1)) return res.sendFile(p1);
  const p2 = path.join(__dirname, '..', 'index.html');
  if (fs.existsSync(p2)) return res.sendFile(p2);
  res.status(404).send('index.html not found');
});

// ─── Token helpers ──────────────────────────────────────────────────────────
function makeToken(role, username) {
  const payload = Buffer.from(JSON.stringify({ role, username, exp: Date.now() + TOKEN_TTL })).toString('base64');
  const sig     = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function parseToken(token) {
  if (!token || !token.includes('.')) return null;
  const dotIdx  = token.indexOf('.');
  const payload = token.slice(0, dotIdx);
  const sig     = token.slice(dotIdx + 1);
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    if (Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── Auth Middleware ─────────────────────────────────────────────────────────
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing authentication token' });
  const data = parseToken(authHeader.slice(7));
  if (!data) return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  req.role = data.role;
  req.username = data.username;
  next();
}

function ownerOnly(req, res, next) {
  verifyToken(req, res, () => {
    if (req.role !== 'owner') return res.status(403).json({ error: 'Owner/Executive access required' });
    next();
  });
}

function anyRole(req, res, next) {
  verifyToken(req, res, next);
}

// ─── Auto site_id helper ────────────────────────────────────────────────────
async function nextSiteId(client) {
  const res = await client.query('SELECT MAX(CAST(SUBSTRING(site_id, 2) AS INTEGER)) AS mx FROM sites');
  const n = (res.rows[0].mx || 0) + 1;
  return 'S' + String(n).padStart(3, '0');
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/login — Supports User ID + Password (and legacy PIN)
app.post('/api/login', (req, res) => {
  const { username, password, pin } = req.body;

  // 1. Dual User ID + Password check
  if (username && password) {
    const u = String(username).trim().toLowerCase();
    const p = String(password).trim();

    if (u === OWNER_USERNAME.toLowerCase() && p === OWNER_PASSWORD) {
      return res.json({ 
        role: 'owner', 
        username: OWNER_USERNAME,
        token: makeToken('owner', OWNER_USERNAME) 
      });
    }

    if (u === ASSISTANT_USERNAME.toLowerCase() && p === ASSISTANT_PASSWORD) {
      return res.json({ 
        role: 'assistant', 
        username: ASSISTANT_USERNAME,
        token: makeToken('assistant', ASSISTANT_USERNAME) 
      });
    }

    return res.status(401).json({ error: 'Incorrect User ID or Password' });
  }

  // 2. PIN fallback
  if (pin) {
    const p = String(pin).trim();
    if (p === OWNER_PASSWORD || p === process.env.OWNER_PIN || p === '1234') {
      return res.json({ role: 'owner', username: OWNER_USERNAME, token: makeToken('owner', OWNER_USERNAME) });
    }
    if (p === ASSISTANT_PASSWORD || p === process.env.ASSISTANT_PIN || p === '5678') {
      return res.json({ role: 'assistant', username: ASSISTANT_USERNAME, token: makeToken('assistant', ASSISTANT_USERNAME) });
    }
    return res.status(401).json({ error: 'Incorrect PIN' });
  }

  return res.status(400).json({ error: 'Please enter User ID and Password' });
});

// GET /api/sites — anyRole: returns [{site_id, site_name}]
app.get('/api/sites', anyRole, async (req, res) => {
  try {
    const result = await pool.query('SELECT site_id, site_name FROM sites ORDER BY site_id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sites/summary — ownerOnly
app.get('/api/sites/summary', ownerOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM v_sites_summary ORDER BY site_id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sites — ownerOnly
app.post('/api/sites', ownerOnly, async (req, res) => {
  const { site_name, client_name, start_date } = req.body;
  if (!site_name) return res.status(400).json({ error: 'site_name is required' });
  const client = await pool.connect();
  try {
    const site_id = await nextSiteId(client);
    await client.query(
      'INSERT INTO sites (site_id, site_name, client_name, start_date) VALUES ($1, $2, $3, $4)',
      [site_id, site_name, client_name || null, start_date || null]
    );
    res.status(201).json({ site_id, site_name, client_name, start_date });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/sites/:id/status — ownerOnly
app.put('/api/sites/:id/status', ownerOnly, async (req, res) => {
  const { status } = req.body;
  if (!['active', 'completed', 'on-hold'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  try {
    await pool.query('UPDATE sites SET status=$1 WHERE site_id=$2', [status, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/sites/:id — ownerOnly (Edit Site Details)
app.put('/api/sites/:id', ownerOnly, async (req, res) => {
  const { site_name, client_name, status, start_date } = req.body;
  if (!site_name) return res.status(400).json({ error: 'Site name is required' });
  try {
    await pool.query(
      'UPDATE sites SET site_name = $1, client_name = $2, status = $3, start_date = $4 WHERE site_id = $5',
      [site_name, client_name || null, status || 'active', start_date || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sites/:id — ownerOnly (Delete Site and related records)
app.delete('/api/sites/:id', ownerOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses WHERE site_id = $1', [req.params.id]);
    await pool.query('DELETE FROM advance_payments WHERE site_id = $1', [req.params.id]);
    await pool.query('DELETE FROM sites WHERE site_id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sites/:id/expenses — ownerOnly
app.get('/api/sites/:id/expenses', ownerOnly, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM v_expense_ledger WHERE site_id=$1 ORDER BY expense_date, id',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sites/:id/expenses — anyRole
app.post('/api/sites/:id/expenses', anyRole, async (req, res) => {
  const { expense_date, description, amount } = req.body;
  if (!expense_date || !description || amount == null)
    return res.status(400).json({ error: 'expense_date, description and amount are required' });
  try {
    const result = await pool.query(
      'INSERT INTO expenses (site_id, expense_date, description, amount) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.params.id, expense_date, description, parseFloat(amount)]
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/expenses/:id — ownerOnly
app.delete('/api/expenses/:id', ownerOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sites/:id/advances — ownerOnly
app.get('/api/sites/:id/advances', ownerOnly, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM v_advance_ledger WHERE site_id=$1 ORDER BY payment_date, id',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sites/:id/advances — ownerOnly
app.post('/api/sites/:id/advances', ownerOnly, async (req, res) => {
  const { payment_date, amount, notes } = req.body;
  if (!payment_date || amount == null)
    return res.status(400).json({ error: 'payment_date and amount are required' });
  try {
    const result = await pool.query(
      'INSERT INTO advance_payments (site_id, payment_date, amount, notes) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.params.id, payment_date, parseFloat(amount), notes || null]
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/advances/:id — ownerOnly
app.delete('/api/advances/:id', ownerOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM advance_payments WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sites/:id/export — ownerOnly
app.get('/api/sites/:id/export', ownerOnly, async (req, res) => {
  try {
    const siteId = req.params.id;
    const siteRes = await pool.query('SELECT site_name FROM sites WHERE site_id=$1', [siteId]);
    const siteName = siteRes.rows[0] ? siteRes.rows[0].site_name : siteId;

    const expRes = await pool.query(
      'SELECT * FROM v_expense_ledger WHERE site_id=$1 ORDER BY expense_date, id', [siteId]
    );
    const advRes = await pool.query(
      'SELECT * FROM v_advance_ledger WHERE site_id=$1 ORDER BY payment_date, id', [siteId]
    );

    const wb = XLSX.utils.book_new();

    // Sheet 1 – Expenses
    const expData = [['Date', 'Description', 'Amount (₹)', 'Cumulative Total (₹)']];
    expRes.rows.forEach(r => expData.push([
      r.expense_date instanceof Date ? r.expense_date.toISOString().slice(0, 10) : String(r.expense_date),
      r.description,
      parseFloat(r.amount),
      parseFloat(r.cumulative_expense)
    ]));
    const wsExp = XLSX.utils.aoa_to_sheet(expData);
    XLSX.utils.book_append_sheet(wb, wsExp, 'Expenses');

    // Sheet 2 – Advances
    const advData = [['Date', 'Amount (₹)', 'Notes', 'Cumulative Total (₹)']];
    advRes.rows.forEach(r => advData.push([
      r.payment_date instanceof Date ? r.payment_date.toISOString().slice(0, 10) : String(r.payment_date),
      parseFloat(r.amount),
      r.notes || '',
      parseFloat(r.cumulative_advance)
    ]));
    const wsAdv = XLSX.utils.aoa_to_sheet(advData);
    XLSX.utils.book_append_sheet(wb, wsAdv, 'Advances');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `${siteName.replace(/[^a-zA-Z0-9]/g, '_')}_report.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export/all — ownerOnly (Complete Database Backup: All Tables)
app.get('/api/export/all', ownerOnly, async (req, res) => {
  try {
    const summaryRes = await pool.query('SELECT * FROM v_sites_summary ORDER BY site_id');
    const expensesRes = await pool.query(`
      SELECT e.site_id, s.site_name, e.expense_date, e.description, e.amount 
      FROM expenses e 
      JOIN sites s ON e.site_id = s.site_id 
      ORDER BY e.site_id, e.expense_date, e.id
    `);
    const advancesRes = await pool.query(`
      SELECT a.site_id, s.site_name, a.payment_date, a.amount, a.notes 
      FROM advance_payments a 
      JOIN sites s ON a.site_id = s.site_id 
      ORDER BY a.site_id, a.payment_date, a.id
    `);
    const sitesRes = await pool.query('SELECT site_id, site_name, client_name, start_date, status FROM sites ORDER BY site_id');

    const wb = XLSX.utils.book_new();

    // Sheet 1: All Sites Summary
    const sumData = [['Site ID', 'Site Name', 'Client', 'Status', 'Total Advance (₹)', 'Total Expenses (₹)', 'Difference (₹)']];
    summaryRes.rows.forEach(r => sumData.push([
      r.site_id, r.site_name, r.client_name || '', r.status,
      parseFloat(r.total_advance || 0), parseFloat(r.total_expenses || 0), parseFloat(r.difference || 0)
    ]));
    const wsSummary = XLSX.utils.aoa_to_sheet(sumData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    // Sheet 2: All Expenses
    const expData = [['Site ID', 'Site Name', 'Expense Date', 'Description', 'Amount (₹)']];
    expensesRes.rows.forEach(r => expData.push([
      r.site_id, r.site_name,
      r.expense_date instanceof Date ? r.expense_date.toISOString().slice(0, 10) : String(r.expense_date),
      r.description,
      parseFloat(r.amount || 0)
    ]));
    const wsExp = XLSX.utils.aoa_to_sheet(expData);
    XLSX.utils.book_append_sheet(wb, wsExp, 'All Expenses');

    // Sheet 3: All Advances
    const advData = [['Site ID', 'Site Name', 'Payment Date', 'Amount Received (₹)', 'Notes / Reference']];
    advancesRes.rows.forEach(r => advData.push([
      r.site_id, r.site_name,
      r.payment_date instanceof Date ? r.payment_date.toISOString().slice(0, 10) : String(r.payment_date),
      parseFloat(r.amount || 0),
      r.notes || ''
    ]));
    const wsAdv = XLSX.utils.aoa_to_sheet(advData);
    XLSX.utils.book_append_sheet(wb, wsAdv, 'All Advances');

    // Sheet 4: Projects Master
    const siteData = [['Site ID', 'Site Name', 'Client Name', 'Start Date', 'Status']];
    sitesRes.rows.forEach(r => siteData.push([
      r.site_id, r.site_name, r.client_name || '',
      r.start_date ? (r.start_date instanceof Date ? r.start_date.toISOString().slice(0, 10) : String(r.start_date).slice(0, 10)) : '',
      r.status
    ]));
    const wsSites = XLSX.utils.aoa_to_sheet(siteData);
    XLSX.utils.book_append_sheet(wb, wsSites, 'Projects Master');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="ContractFlow_Full_Database_Backup.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sites/:id/expenses/today — anyRole (assistant today view)
app.get('/api/sites/:id/expenses/today', anyRole, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await pool.query(
      'SELECT id, expense_date, description, amount FROM expenses WHERE site_id=$1 AND expense_date=$2 ORDER BY id',
      [req.params.id, today]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start server / Export for Vercel ─────────────────────────────────────
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`ContractFlow server running on port ${PORT}`);
    pool.connect()
      .then(client => {
        console.log('PostgreSQL (Supabase) Database connected ✓');
        client.release();
      })
      .catch(e => console.error('Database connection failed:', e.message));
  });
}

module.exports = app;
