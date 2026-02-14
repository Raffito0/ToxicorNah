/*
  # Create storage bucket for chat screenshots

  1. New Storage Bucket
    - `chat-screenshots` - Stores uploaded chat screenshot images
  
  2. Security
    - Public bucket for easy access
    - RLS policies for authenticated and anonymous users to upload
*/

-- Create the storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-screenshots', 'chat-screenshots', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload
CREATE POLICY "Authenticated users can upload chat screenshots"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'chat-screenshots');

-- Allow anonymous users to upload
CREATE POLICY "Anonymous users can upload chat screenshots"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'chat-screenshots');

-- Allow public read access
CREATE POLICY "Public can view chat screenshots"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'chat-screenshots');
