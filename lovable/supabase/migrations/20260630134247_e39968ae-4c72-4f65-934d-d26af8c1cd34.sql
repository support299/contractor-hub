
CREATE TABLE public.hub_leave_approvals (
  submission_id UUID PRIMARY KEY REFERENCES public.hub_form_submissions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_leave_approvals TO anon, authenticated;
GRANT ALL ON public.hub_leave_approvals TO service_role;

ALTER TABLE public.hub_leave_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view leave approvals" ON public.hub_leave_approvals FOR SELECT USING (true);
CREATE POLICY "Anyone can insert leave approvals" ON public.hub_leave_approvals FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update leave approvals" ON public.hub_leave_approvals FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete leave approvals" ON public.hub_leave_approvals FOR DELETE USING (true);

CREATE TRIGGER update_hub_leave_approvals_updated_at
BEFORE UPDATE ON public.hub_leave_approvals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.hub_leave_approvals;
