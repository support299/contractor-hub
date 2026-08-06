CREATE POLICY "Anyone can read hub-documents" ON storage.objects FOR SELECT USING (bucket_id = 'hub-documents');
CREATE POLICY "Anyone can upload hub-documents" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'hub-documents');
CREATE POLICY "Anyone can update hub-documents" ON storage.objects FOR UPDATE USING (bucket_id = 'hub-documents');
CREATE POLICY "Anyone can delete hub-documents" ON storage.objects FOR DELETE USING (bucket_id = 'hub-documents');