/*
  # Add Avatar Support to Persons Table

  1. Changes
    - Add `avatar` column to `persons` table to store avatar image URL
    - Column is nullable and defaults to null
    - Stores relative path to avatar image in public folder

  2. Security
    - No changes to RLS policies needed
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'persons' AND column_name = 'avatar'
  ) THEN
    ALTER TABLE persons ADD COLUMN avatar text;
  END IF;
END $$;