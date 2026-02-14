/*
  # Create storage bucket for dynamic section archetype images

  1. New Storage Bucket
    - `dynamic-archetypes` - Stores vertical 9:16 archetype images for The Dynamic section
    - Organized in subfolders: person/ and user/

  2. Security
    - Public bucket for read access (images displayed to all users)
*/

-- Create the storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('dynamic-archetypes', 'dynamic-archetypes', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "Public can view dynamic archetype images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'dynamic-archetypes');

-- Allow authenticated users to upload (for admin use)
CREATE POLICY "Authenticated users can upload dynamic archetype images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'dynamic-archetypes');
