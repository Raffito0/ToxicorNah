import { addIllustration, mapIllustrationToArchetype } from './src/services/illustrationService';
import { supabase } from './src/lib/supabase';

async function example() {
  console.log('=== HOW TO ADD ILLUSTRATIONS ===\n');

  console.log('Step 1: Get your archetype IDs');
  const { data: archetypes } = await supabase.from('archetypes').select('id, name, category');
  console.log('Available archetypes:', archetypes);
  console.log('');

  console.log('Step 2: Add a new illustration');
  const newIllustration = await addIllustration(
    'https://example.com/my-new-image.jpg',
    ['happy', 'energetic', 'warm'],
    'EMOTIONAL TONE',
    'portrait'
  );
  console.log('Added illustration:', newIllustration);
  console.log('');

  if (newIllustration && archetypes && archetypes.length > 0) {
    console.log('Step 3: Map illustration to archetype');
    const success = await mapIllustrationToArchetype(
      archetypes[0].id,
      newIllustration.id,
      100
    );
    console.log('Mapping successful:', success);
  }
}

example();
