import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

interface IllustrationData {
  url: string;
  tags: string[];
  category?: string;
  style?: string;
}

async function bulkUploadIllustrations(filePath: string) {
  try {
    const fileContent = readFileSync(filePath, 'utf-8');
    const illustrations: IllustrationData[] = JSON.parse(fileContent);

    console.log(`📦 Found ${illustrations.length} illustrations to upload`);

    const { data, error } = await supabase
      .from('illustrations')
      .insert(illustrations)
      .select();

    if (error) {
      console.error('❌ Error uploading illustrations:', error);
      process.exit(1);
    }

    console.log(`✅ Successfully uploaded ${data.length} illustrations!`);
    console.log('\n📊 Summary:');

    const byCategory: Record<string, number> = {};
    data.forEach((ill: any) => {
      const cat = ill.category || 'uncategorized';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });

    Object.entries(byCategory).forEach(([category, count]) => {
      console.log(`   ${category}: ${count} images`);
    });

  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

const filePath = process.argv[2];

if (!filePath) {
  console.error('❌ Please provide a JSON file path');
  console.log('\nUsage: npm run upload-illustrations <path-to-file.json>');
  console.log('\nExample: npm run upload-illustrations ./my-illustrations.json');
  process.exit(1);
}

bulkUploadIllustrations(filePath);
