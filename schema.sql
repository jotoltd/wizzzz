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

-- ===== CRM additions round 3 =====

-- Credit notes + public links + recurring + payment links on invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'invoice'; -- invoice | credit_note
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS public_token uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS recur_interval text;  -- monthly | quarterly | yearly
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS next_run date;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_link text;

-- Settings round 3
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS resend_api_key text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS resend_from text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS credit_prefix text NOT NULL DEFAULT 'CN-';
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS next_credit_number int NOT NULL DEFAULT 1;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS default_hourly_rate numeric NOT NULL DEFAULT 0;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS admin_email text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS payment_link text;
UPDATE public.settings SET admin_email = 'hello@wizzz.co.uk' WHERE id = 1 AND admin_email IS NULL;

-- ===== Time tracking =====
CREATE TABLE IF NOT EXISTS public.time_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  entry_date  date NOT NULL DEFAULT current_date,
  hours       numeric NOT NULL,
  note        text,
  hourly_rate numeric,
  invoiced    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS time_entries_project_id_idx ON public.time_entries(project_id);

-- ===== Portal link: client <-> auth user =====
CREATE TABLE IF NOT EXISTS public.client_users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, user_id)
);

-- ===== Admin check: only the settings.admin_email account =====
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u, public.settings s
    WHERE u.id = auth.uid() AND s.id = 1 AND lower(u.email) = lower(s.admin_email)
  );
$$;

-- ===== Tighten RLS: admin full access on all existing tables =====
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients','projects','invoices','invoice_items','payments',
    'expenses','settings','quotes','quote_items','activities','tasks'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%I_auth_all" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%I_admin_all" ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())',
      t, t);
  END LOOP;
END $$;

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_entries_admin_all" ON public.time_entries;
CREATE POLICY "time_entries_admin_all" ON public.time_entries
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- client_users: admin manages, portal users read their own link
DROP POLICY IF EXISTS "client_users_admin_all" ON public.client_users;
CREATE POLICY "client_users_admin_all" ON public.client_users
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "client_users_self_read" ON public.client_users;
CREATE POLICY "client_users_self_read" ON public.client_users
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ===== Portal read-only access (client sees only their own records) =====
DROP POLICY IF EXISTS "portal_clients_read" ON public.clients;
CREATE POLICY "portal_clients_read" ON public.clients
  FOR SELECT TO authenticated
  USING (id IN (SELECT client_id FROM public.client_users WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "portal_projects_read" ON public.projects;
CREATE POLICY "portal_projects_read" ON public.projects
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT client_id FROM public.client_users WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "portal_invoices_read" ON public.invoices;
CREATE POLICY "portal_invoices_read" ON public.invoices
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT client_id FROM public.client_users WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "portal_items_read" ON public.invoice_items;
CREATE POLICY "portal_items_read" ON public.invoice_items
  FOR SELECT TO authenticated
  USING (invoice_id IN (
    SELECT i.id FROM public.invoices i
    WHERE i.client_id IN (SELECT client_id FROM public.client_users WHERE user_id = auth.uid())
  ));

-- ===== Public invoice lookup (token-gated, anon-safe) =====
CREATE OR REPLACE FUNCTION public.get_public_invoice(tok uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'invoice_number', i.invoice_number,
    'doc_type', i.doc_type,
    'status', i.status,
    'issue_date', i.issue_date,
    'due_date', i.due_date,
    'vat_rate', i.vat_rate,
    'notes', i.notes,
    'payment_link', i.payment_link,
    'client_name', c.name,
    'client_company', c.company,
    'client_address', c.address,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('description', it.description, 'qty', it.qty, 'rate', it.rate) ORDER BY it.sort)
      FROM public.invoice_items it WHERE it.invoice_id = i.id
    ), '[]'::jsonb),
    'paid', COALESCE((
      SELECT sum(p.amount) FROM public.payments p WHERE p.invoice_id = i.id
    ), 0),
    'business', jsonb_build_object(
      'name', 'WIZZZ',
      'legal', 'A trading name of Gedker Ltd',
      'email', 'hello@wizzz.co.uk',
      'web', 'wizzz.co.uk',
      'bank_name', s.bank_name,
      'account_name', s.account_name,
      'sort_code', s.sort_code,
      'account_number', s.account_number,
      'payment_link', s.payment_link
    )
  )
  FROM public.invoices i
  LEFT JOIN public.clients c ON c.id = i.client_id
  LEFT JOIN public.settings s ON s.id = 1
  WHERE i.public_token = tok;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_invoice(uuid) TO anon, authenticated;

-- ===== Admin: link/unlink a portal login to a client =====
CREATE OR REPLACE FUNCTION public.link_portal_user(p_client uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE uid uuid;
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('error', 'Not admin'); END IF;
  SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF uid IS NULL THEN
    RETURN jsonb_build_object('error', 'No account for that email — the client must sign up on the portal first.');
  END IF;
  INSERT INTO public.client_users (client_id, user_id) VALUES (p_client, uid) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.unlink_portal_user(p_client uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('error', 'Not admin'); END IF;
  DELETE FROM public.client_users cu
  USING auth.users u
  WHERE cu.user_id = u.id AND cu.client_id = p_client AND lower(u.email) = lower(trim(p_email));
  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.link_portal_user(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_portal_user(uuid, text) TO authenticated;

-- ===== Send invoice email via Resend (key stored in settings) =====
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.send_invoice_email(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record; s record; client_email text; resp extensions.http_response;
  pub_url text; subj text; body text;
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('error', 'Not admin'); END IF;
  SELECT * INTO s FROM public.settings WHERE id = 1;
  SELECT i.*, c.email AS c_email, c.name AS c_name INTO inv
    FROM public.invoices i LEFT JOIN public.clients c ON c.id = i.client_id
    WHERE i.id = p_invoice_id;
  IF inv.id IS NULL THEN RETURN jsonb_build_object('error', 'Invoice not found'); END IF;
  IF s.resend_api_key IS NULL THEN RETURN jsonb_build_object('error', 'Add your Resend API key in Settings first.'); END IF;
  IF inv.c_email IS NULL THEN RETURN jsonb_build_object('error', 'Client has no email address.'); END IF;

  pub_url := 'https://wizzz.co.uk/invoice.html?t=' || inv.public_token::text;
  subj := 'Invoice ' || inv.invoice_number || ' from WIZZZ';
  body := 'Hi ' || coalesce(inv.c_name, 'there') || E',\n\n'
    || 'Your invoice ' || inv.invoice_number || ' is ready. You can view and pay it here:' || E'\n\n'
    || pub_url || E'\n\n'
    || 'Thanks,' || E'\n' || 'WIZZZ' || E'\n' || 'hello@wizzz.co.uk · wizzz.co.uk';

  resp := extensions.http((
    'POST',
    'https://api.resend.com/emails',
    ARRAY[
      extensions.http_header('Authorization', 'Bearer ' || s.resend_api_key),
      extensions.http_header('Content-Type', 'application/json')
    ]::extensions.http_header[],
    'application/json',
    jsonb_build_object(
      'from', coalesce(s.resend_from, 'WIZZZ <hello@wizzz.co.uk>'),
      'to', jsonb_build_array(inv.c_email),
      'subject', subj,
      'text', body
    )::text
  )::extensions.http_request);

  IF resp.status BETWEEN 200 AND 299 THEN
    UPDATE public.invoices SET status = 'sent' WHERE id = p_invoice_id AND status = 'draft';
    RETURN jsonb_build_object('ok', true, 'status', resp.status);
  END IF;
  RETURN jsonb_build_object('error', 'Resend error ' || resp.status || ': ' || resp.content);
END $$;

GRANT EXECUTE ON FUNCTION public.send_invoice_email(uuid) TO authenticated;

-- ===== Recurring invoices via pg_cron =====
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.run_recurring_invoices()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record; s record; newid uuid; num text; step interval;
BEGIN
  SELECT * INTO s FROM public.settings WHERE id = 1;
  FOR r IN
    SELECT * FROM public.invoices
    WHERE is_recurring AND next_run IS NOT NULL AND next_run <= current_date
  LOOP
    step := CASE r.recur_interval
      WHEN 'monthly' THEN interval '1 month'
      WHEN 'quarterly' THEN interval '3 months'
      WHEN 'yearly' THEN interval '1 year'
      ELSE interval '1 month' END;
    num := s.invoice_prefix || lpad(s.next_invoice_number::text, 4, '0');

    INSERT INTO public.invoices (invoice_number, client_id, project_id, status, issue_date, due_date, vat_rate, notes, doc_type, payment_link)
    VALUES (num, r.client_id, r.project_id, 'draft', current_date,
            current_date + coalesce(s.payment_terms_days, 14), r.vat_rate, r.notes, r.doc_type, r.payment_link)
    RETURNING id INTO newid;

    INSERT INTO public.invoice_items (invoice_id, description, qty, rate, sort)
    SELECT newid, description, qty, rate, sort FROM public.invoice_items WHERE invoice_id = r.id;

    UPDATE public.invoices SET next_run = r.next_run + step WHERE id = r.id;
    UPDATE public.settings SET next_invoice_number = next_invoice_number + 1 WHERE id = 1;
    s.next_invoice_number := s.next_invoice_number + 1;
  END LOOP;
END $$;

-- run every day at 06:15 UTC
SELECT cron.schedule('generate-recurring-invoices', '15 6 * * *', 'SELECT public.run_recurring_invoices()')
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-recurring-invoices');

-- ===== Round 3 fix-ups =====
ALTER TABLE public.client_users ADD COLUMN IF NOT EXISTS email text;

-- Store email on link for display purposes
CREATE OR REPLACE FUNCTION public.link_portal_user(p_client uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE uid uuid;
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('error', 'Not admin'); END IF;
  SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF uid IS NULL THEN
    RETURN jsonb_build_object('error', 'No account for that email — the client must sign up on the portal first.');
  END IF;
  INSERT INTO public.client_users (client_id, user_id, email) VALUES (p_client, uid, lower(trim(p_email))) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Admin creates a portal login directly (auto-confirmed, no email flow needed)
CREATE OR REPLACE FUNCTION public.create_portal_user(p_client uuid, p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE uid uuid;
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('error', 'Not admin'); END IF;
  p_email := lower(trim(p_email));
  IF length(p_password) < 8 THEN RETURN jsonb_build_object('error', 'Password must be at least 8 characters.'); END IF;

  SELECT id INTO uid FROM auth.users WHERE lower(email) = p_email;
  IF uid IS NULL THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
      'authenticated', 'authenticated', p_email,
      crypt(p_password, gen_salt('bf')),
      now(), now(), now(), '', '', '', '',
      '{"provider":"email","providers":["email"]}', '{}'
    ) RETURNING id INTO uid;

    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', p_email), 'email', now(), now(), now());
  END IF;

  INSERT INTO public.client_users (client_id, user_id, email) VALUES (p_client, uid, p_email) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.create_portal_user(uuid, text, text) TO authenticated;
