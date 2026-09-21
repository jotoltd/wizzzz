-- WIZZZ admin schema
-- Clients + Projects, locked down to authenticated users (Josh) via RLS

-- ===== Clients =====
CREATE TABLE IF NOT EXISTS public.clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  company     text,
  email       text,
  phone       text,
  notes       text,
  status      text NOT NULL DEFAULT 'active',  -- active | paused | done
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ===== Projects =====
CREATE TABLE IF NOT EXISTS public.projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  title       text NOT NULL,
  type        text,                              -- website | ios | ads
  status      text NOT NULL DEFAULT 'planning',  -- planning | in_progress | review | done
  brief       text,
  budget      numeric,
  due_date    date,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_client_id_idx ON public.projects(client_id);

-- ===== Row Level Security =====
ALTER TABLE public.clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can do anything with clients
DROP POLICY IF EXISTS "clients_auth_all" ON public.clients;
CREATE POLICY "clients_auth_all" ON public.clients
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Only authenticated users can do anything with projects
DROP POLICY IF EXISTS "projects_auth_all" ON public.projects;
CREATE POLICY "projects_auth_all" ON public.projects
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ===== CRM additions =====
-- Billing address for invoices
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS address text;

-- ===== Invoices =====
CREATE TABLE IF NOT EXISTS public.invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  text NOT NULL,
  client_id       uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  project_id      uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'draft',   -- draft | sent | paid | void
  issue_date      date NOT NULL DEFAULT current_date,
  due_date        date,
  vat_rate        numeric NOT NULL DEFAULT 0,      -- percent, e.g. 20
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_client_id_idx ON public.invoices(client_id);

-- ===== Invoice line items =====
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  qty         numeric NOT NULL DEFAULT 1,
  rate        numeric NOT NULL DEFAULT 0,
  sort        int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS invoice_items_invoice_id_idx ON public.invoice_items(invoice_id);

-- ===== Payments =====
CREATE TABLE IF NOT EXISTS public.payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount      numeric NOT NULL,
  paid_on     date NOT NULL DEFAULT current_date,
  method      text,                              -- bank | card | cash | other
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_invoice_id_idx ON public.payments(invoice_id);

-- ===== Expenses =====
CREATE TABLE IF NOT EXISTS public.expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incurred_on date NOT NULL DEFAULT current_date,
  category    text,                              -- software | hardware | travel | subs | other
  vendor      text,
  description text,
  amount      numeric NOT NULL,
  billable    boolean NOT NULL DEFAULT false,
  client_id   uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ===== Settings (single row, id = 1) =====
CREATE TABLE IF NOT EXISTS public.settings (
  id                  int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bank_name           text,
  account_name        text DEFAULT 'Gedker Ltd',
  sort_code           text,
  account_number      text,
  payment_terms_days  int NOT NULL DEFAULT 14,
  vat_rate            numeric NOT NULL DEFAULT 20,
  invoice_prefix      text NOT NULL DEFAULT 'INV-',
  next_invoice_number int NOT NULL DEFAULT 1,
  invoice_notes       text
);

INSERT INTO public.settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ===== RLS for new tables =====
ALTER TABLE public.invoices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_auth_all" ON public.invoices;
CREATE POLICY "invoices_auth_all" ON public.invoices
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "invoice_items_auth_all" ON public.invoice_items;
CREATE POLICY "invoice_items_auth_all" ON public.invoice_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "payments_auth_all" ON public.payments;
CREATE POLICY "payments_auth_all" ON public.payments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "expenses_auth_all" ON public.expenses;
CREATE POLICY "expenses_auth_all" ON public.expenses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "settings_auth_all" ON public.settings;
CREATE POLICY "settings_auth_all" ON public.settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ===== CRM additions round 2 =====
-- Track which billable expenses have been invoiced
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS invoiced boolean NOT NULL DEFAULT false;

-- Quote numbering alongside invoice numbering
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS quote_prefix text NOT NULL DEFAULT 'Q-';
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS next_quote_number int NOT NULL DEFAULT 1;

-- ===== Quotes =====
CREATE TABLE IF NOT EXISTS public.quotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number    text NOT NULL,
  client_id       uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  project_id      uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'draft',   -- draft | sent | accepted | declined
  issue_date      date NOT NULL DEFAULT current_date,
  valid_until     date,
  vat_rate        numeric NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quotes_client_id_idx ON public.quotes(client_id);

CREATE TABLE IF NOT EXISTS public.quote_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  description text NOT NULL,
  qty         numeric NOT NULL DEFAULT 1,
  rate        numeric NOT NULL DEFAULT 0,
  sort        int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS quote_items_quote_id_idx ON public.quote_items(quote_id);

-- ===== Client activity log =====
CREATE TABLE IF NOT EXISTS public.activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  type        text NOT NULL DEFAULT 'note',        -- note | call | email | meeting
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activities_client_id_idx ON public.activities(client_id);

-- ===== Tasks / follow-ups =====
CREATE TABLE IF NOT EXISTS public.tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  due_date    date,
  done        boolean NOT NULL DEFAULT false,
  client_id   uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ===== RLS =====
ALTER TABLE public.quotes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quotes_auth_all" ON public.quotes;
CREATE POLICY "quotes_auth_all" ON public.quotes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "quote_items_auth_all" ON public.quote_items;
CREATE POLICY "quote_items_auth_all" ON public.quote_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "activities_auth_all" ON public.activities;
CREATE POLICY "activities_auth_all" ON public.activities
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "tasks_auth_all" ON public.tasks;
CREATE POLICY "tasks_auth_all" ON public.tasks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
