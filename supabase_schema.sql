-- ═══════════════════════════════════════════════════════════════
-- Lone Star Wheel Repairs — Supabase Schema
-- Run this entire file in: Supabase → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════

-- ── Shops (linked to Supabase Auth users) ────────────────────
CREATE TABLE IF NOT EXISTS public.shops (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name        TEXT NOT NULL,
  owner_name  TEXT,
  phone       TEXT,
  email       TEXT,
  city        TEXT,
  zip         TEXT,
  tier        TEXT DEFAULT 'basic',
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Leads (every quote form submission) ──────────────────────
CREATE TABLE IF NOT EXISTS public.leads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT,
  phone          TEXT,
  email          TEXT,
  city           TEXT,
  zip            TEXT,
  vehicle_year   TEXT,
  vehicle_make   TEXT,
  vehicle_model  TEXT,
  wheel_count    TEXT,
  repair_type    TEXT,
  damage_desc    TEXT,
  photos_count   INTEGER DEFAULT 0,
  language       TEXT DEFAULT 'English',
  submitted_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Lead Assignments (which shops receive which leads) ────────
CREATE TABLE IF NOT EXISTS public.lead_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  shop_id      UUID REFERENCES public.shops(id) ON DELETE CASCADE,
  status       TEXT DEFAULT 'new',   -- new | contacted | quoted | won | lost
  notes        TEXT,
  assigned_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lead_id, shop_id)
);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_assignments ENABLE ROW LEVEL SECURITY;

-- Shops: read and update own profile only
CREATE POLICY "shops_own_profile"
  ON public.shops FOR ALL
  USING (auth.uid() = id);

-- Leads: shops can only see leads assigned to them
CREATE POLICY "shops_see_assigned_leads"
  ON public.leads FOR SELECT
  USING (
    id IN (
      SELECT lead_id FROM public.lead_assignments
      WHERE shop_id = auth.uid()
    )
  );

-- Lead assignments: shops see and update their own assignments
CREATE POLICY "shops_own_assignments"
  ON public.lead_assignments FOR ALL
  USING (shop_id = auth.uid());

-- ── Shop Applications (pre-signup form submissions) ─────────
CREATE TABLE IF NOT EXISTS public.shop_applications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_name   TEXT NOT NULL,
  owner_name  TEXT,
  phone       TEXT,
  email       TEXT,
  zip         TEXT,
  city        TEXT,
  tier        TEXT,
  radius      INTEGER,
  status      TEXT DEFAULT 'pending',  -- pending | approved | rejected
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.shop_applications ENABLE ROW LEVEL SECURITY;

-- Service role only (no public read access to applications)
CREATE POLICY "service_role_only_applications"
  ON public.shop_applications FOR ALL
  USING (false);

-- ── Auto-update updated_at on lead_assignments ────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_assignments_updated_at
  BEFORE UPDATE ON public.lead_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
