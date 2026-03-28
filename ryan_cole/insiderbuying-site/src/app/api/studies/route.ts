import { NextResponse } from 'next/server';

const NOCODB_URL = process.env.NOCODB_URL || 'http://localhost:8080';
const NOCODB_TOKEN = process.env.NOCODB_READ_TOKEN || '';

export const revalidate = 300; // 5 minutes ISR

export async function GET() {
  try {
    const response = await fetch(
      `${NOCODB_URL}/api/v2/tables/Data_Studies/records?where=(status,eq,published)&sort=-published_at&limit=50`,
      {
        headers: {
          'xc-token': NOCODB_TOKEN,
        },
        next: { revalidate: 300 },
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch studies' },
        { status: 502 }
      );
    }

    const data = await response.json();
    const studies = (data.list || []).map((row: Record<string, unknown>) => ({
      id: row.Id || row.id,
      title: row.title || '',
      study_type: row.study_type || '',
      data_period: row.data_period || '',
      key_findings: row.key_findings || '',
      charts_data: row.charts_data ? JSON.parse(row.charts_data as string) : [],
      published_at: row.published_at || '',
    }));

    return NextResponse.json({ studies });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
