CREATE TABLE public.hub_forms (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_forms TO anon, authenticated;
GRANT ALL ON public.hub_forms TO service_role;

ALTER TABLE public.hub_forms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read hub forms" ON public.hub_forms FOR SELECT USING (true);
CREATE POLICY "Anyone can insert hub forms" ON public.hub_forms FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update hub forms" ON public.hub_forms FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete hub forms" ON public.hub_forms FOR DELETE USING (true);

CREATE TRIGGER update_hub_forms_updated_at
BEFORE UPDATE ON public.hub_forms
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();