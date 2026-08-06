
CREATE TABLE public.hub_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'employee',
  status TEXT NOT NULL DEFAULT 'active',
  sectors TEXT[] NOT NULL DEFAULT '{}',
  work_days NUMERIC,
  picture TEXT,
  position TEXT,
  jobber_id TEXT,
  ghl_id TEXT,
  regular_rate NUMERIC,
  drive_time_rate NUMERIC,
  fc_rate NUMERIC,
  tr_rate NUMERIC,
  supplies_deduction NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_users TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_users TO authenticated;
GRANT ALL ON public.hub_users TO service_role;

ALTER TABLE public.hub_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read hub users"
  ON public.hub_users FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert hub users"
  ON public.hub_users FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update hub users"
  ON public.hub_users FOR UPDATE
  USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can delete hub users"
  ON public.hub_users FOR DELETE
  USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_hub_users_updated_at
  BEFORE UPDATE ON public.hub_users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
