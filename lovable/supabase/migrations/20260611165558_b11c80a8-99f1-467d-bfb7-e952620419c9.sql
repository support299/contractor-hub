CREATE TABLE public.hub_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.hub_alerts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_alerts TO authenticated;
GRANT ALL ON public.hub_alerts TO service_role;

ALTER TABLE public.hub_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view alerts" ON public.hub_alerts FOR SELECT USING (true);
CREATE POLICY "Authenticated can insert alerts" ON public.hub_alerts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update alerts" ON public.hub_alerts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete alerts" ON public.hub_alerts FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_hub_alerts_updated_at BEFORE UPDATE ON public.hub_alerts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();