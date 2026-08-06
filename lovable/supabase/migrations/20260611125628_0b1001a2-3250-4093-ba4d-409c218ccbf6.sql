
ALTER TABLE public.hub_forms ADD COLUMN IF NOT EXISTS slug text;
UPDATE public.hub_forms SET slug = 'form-' || substr(md5(random()::text || id::text), 1, 8) WHERE slug IS NULL OR slug = '';
ALTER TABLE public.hub_forms ALTER COLUMN slug SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_forms_slug_unique') THEN
    ALTER TABLE public.hub_forms ADD CONSTRAINT hub_forms_slug_unique UNIQUE (slug);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.hub_form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.hub_forms(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT ON public.hub_form_submissions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_form_submissions TO authenticated;
GRANT ALL ON public.hub_form_submissions TO service_role;
ALTER TABLE public.hub_form_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can insert submissions" ON public.hub_form_submissions;
DROP POLICY IF EXISTS "Anyone can read submissions" ON public.hub_form_submissions;
CREATE POLICY "Anyone can insert submissions" ON public.hub_form_submissions FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read submissions" ON public.hub_form_submissions FOR SELECT USING (true);
