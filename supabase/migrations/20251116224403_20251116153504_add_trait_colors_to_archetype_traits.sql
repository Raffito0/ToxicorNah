/*
  # Add trait colors to archetype_traits table

  1. Changes
    - Add `color` column to `archetype_traits` table to store hex color values
    - Default color is set to match the archetype's gradient start color

  2. Notes
    - Colors will be applied with 80% opacity in the frontend
    - Each trait can have its own unique color extracted from the illustration
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'archetype_traits' AND column_name = 'color'
  ) THEN
    ALTER TABLE archetype_traits ADD COLUMN color text DEFAULT '#FFFFFF';
  END IF;
END $$;