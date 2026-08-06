CREATE POLICY "Anyone can upload to form-uploads"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'form-uploads');

CREATE POLICY "Anyone can read form-uploads"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'form-uploads');

CREATE POLICY "Anyone can delete form-uploads"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'form-uploads');