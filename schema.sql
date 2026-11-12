CREATE DATABASE IF NOT EXISTS contractflow;
USE contractflow;

CREATE TABLE sites (
  site_id VARCHAR(10) PRIMARY KEY,
  site_name VARCHAR(100) NOT NULL,
  client_name VARCHAR(100),
  start_date DATE,
  status ENUM('active','completed','on-hold') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE advance_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  site_id VARCHAR(10) NOT NULL,
  payment_date DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  notes VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(site_id)
);

CREATE TABLE expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  site_id VARCHAR(10) NOT NULL,
  expense_date DATE NOT NULL,
  description VARCHAR(255) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(site_id)
);

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
LEFT JOIN (SELECT site_id, SUM(amount) AS total_advance FROM advance_payments GROUP BY site_id) adv ON s.site_id = adv.site_id
LEFT JOIN (SELECT site_id, SUM(amount) AS total_expenses FROM expenses GROUP BY site_id) exp ON s.site_id = exp.site_id;

INSERT INTO sites VALUES ('S001','Sharma Residence','Ramesh Sharma','2026-10-01','active',NOW());
INSERT INTO sites VALUES ('S002','Raj Commercial','Raj Kumar','2026-10-03','active',NOW());
INSERT INTO advance_payments (site_id, payment_date, amount, notes) VALUES
  ('S001','2026-10-01',200000,'Initial advance'),
  ('S001','2026-10-15',150000,'Second installment'),
  ('S002','2026-10-03',500000,'Full advance');
INSERT INTO expenses (site_id, expense_date, description, amount) VALUES
  ('S001','2026-11-01','River sand - 5 loads',12500),
  ('S001','2026-11-01','Cement - 50 bags',27500),
  ('S001','2026-11-02','Mason - 4 workers',4800),
  ('S002','2026-11-01','Steel rods - 500 kg',45000),
  ('S002','2026-11-02','Bricks - 5000 nos',35000);
