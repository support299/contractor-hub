CREATE POLICY "Anyone can update submissions" ON public.hub_form_submissions FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete submissions" ON public.hub_form_submissions FOR DELETE USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_form_submissions TO anon, authenticated;
GRANT ALL ON public.hub_form_submissions TO service_role;