CREATE TABLE public.hub_training_materials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_training_materials TO anon, authenticated;
GRANT ALL ON public.hub_training_materials TO service_role;
ALTER TABLE public.hub_training_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read training" ON public.hub_training_materials FOR SELECT USING (true);
CREATE POLICY "Anyone can insert training" ON public.hub_training_materials FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update training" ON public.hub_training_materials FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete training" ON public.hub_training_materials FOR DELETE USING (true);
CREATE TRIGGER set_updated_at_training BEFORE UPDATE ON public.hub_training_materials FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.hub_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  file_type TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_documents TO anon, authenticated;
GRANT ALL ON public.hub_documents TO service_role;
ALTER TABLE public.hub_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read documents" ON public.hub_documents FOR SELECT USING (true);
CREATE POLICY "Anyone can insert documents" ON public.hub_documents FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update documents" ON public.hub_documents FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete documents" ON public.hub_documents FOR DELETE USING (true);
CREATE TRIGGER set_updated_at_documents BEFORE UPDATE ON public.hub_documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();