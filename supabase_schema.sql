-- ============================================================
-- ContractFlow: Supabase (PostgreSQL) Schema & Views
-- Paste this entire script into Supabase -> SQL Editor -> Run
-- ============================================================

-- 1. Sites Table
CREATE TABLE IF NOT EXISTS sites (
  site_id VARCHAR(10) PRIMARY KEY,
  site_name VARCHAR(100) NOT NULL,
  client_name VARCHAR(100),
  start_date DATE,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'on-hold')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Advance Payments Table (Owner only)
CREATE TABLE IF NOT EXISTS advance_payments (
  id SERIAL PRIMARY KEY,
  site_id VARCHAR(10) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Daily Expenses Table (Logged by Assistant)
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  site_id VARCHAR(10) NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  expense_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Advance Ledger View (Calculates cumulative total per site)
CREATE OR REPLACE VIEW v_advance_ledger AS
SELECT 
  a.id,
  a.site_id,
  s.site_name,
  a.payment_date,
  a.amount,
  a.notes,
  SUM(a.amount) OVER (PARTITION BY a.site_id ORDER BY a.payment_date, a.id) AS cumulative_advance
FROM advance_payments a
JOIN sites s ON a.site_id = s.site_id;

-- 5. Daily Expense Ledger View (Calculates cumulative total per site)
CREATE OR REPLACE VIEW v_expense_ledger AS
SELECT 
  e.id,
  e.site_id,
  s.site_name,
  e.expense_date,
  e.description,
  e.amount,
  SUM(e.amount) OVER (PARTITION BY e.site_id ORDER BY e.expense_date, e.id) AS cumulative_expense
FROM expenses e
JOIN sites s ON e.site_id = s.site_id;

-- 6. All Sites Summary View (Auto-updates with live totals & difference)
CREATE OR REPLACE VIEW v_sites_summary AS
SELECT 
  s.site_id,
  s.site_name,
  s.client_name,
  s.status,
  COALESCE(adv.total_advance, 0) AS total_advance,
  COALESCE(exp.total_expenses, 0) AS total_expenses,
  COALESCE(adv.total_advance, 0) - COALESCE(exp.total_expenses, 0) AS difference
FROM sites s
LEFT JOIN (
  SELECT site_id, SUM(amount) AS total_advance 
  FROM advance_payments 
  GROUP BY site_id
) adv ON s.site_id = adv.site_id
LEFT JOIN (
  SELECT site_id, SUM(amount) AS total_expenses 
  FROM expenses 
  GROUP BY site_id
) exp ON s.site_id = exp.site_id;

-- 7. Sample Initial Data
INSERT INTO sites (site_id, site_name, client_name, start_date, status) VALUES 
  ('S001', 'Sharma Residence', 'Ramesh Sharma', '2026-10-01', 'active'),
  ('S002', 'Raj Commercial', 'Raj Kumar', '2026-10-03', 'active')
ON CONFLICT (site_id) DO NOTHING;

INSERT INTO advance_payments (site_id, payment_date, amount, notes) VALUES 
  ('S001', '2026-10-01', 200000, 'Initial advance'),
  ('S001', '2026-10-15', 150000, 'Second installment'),
  ('S002', '2026-10-03', 500000, 'Full advance');

INSERT INTO expenses (site_id, expense_date, description, amount) VALUES 
  ('S001', '2026-11-01', 'River sand - 5 loads', 12500),
  ('S001', '2026-11-01', 'Cement - 50 bags', 27500),
  ('S001', '2026-11-02', 'Mason - 4 workers', 4800),
  ('S001', '2026-11-02', 'Helper - 6 workers', 4200),
  ('S002', '2026-11-01', 'Steel rods - 500 kg', 45000),
  ('S002', '2026-11-02', 'Bricks - 5000 nos', 35000);
