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
