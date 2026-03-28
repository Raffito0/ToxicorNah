# Section 06: Reports Page Integration

## Objective
Wire /reports page to display data studies from NocoDB with chart rendering via Recharts.

## Implementation

### 1. Install Recharts
npm install recharts

### 2. Data Studies API route
Create `src/app/api/studies/route.ts`:
- GET: query NocoDB Data_Studies table where status='published', sorted by published_at DESC
- Returns: array of studies with title, key_findings, charts_data, published_at
- Cache: ISR 5 minutes

### 3. Update /reports page
The page already shows report cards. Add a "Data Studies" tab/section:
- Fetch from /api/studies
- Each study card: title, date, key finding teaser, "Read Study" link
- Study detail: expand inline or new page with Recharts rendering charts_data

### 4. Charts component
Create `src/components/StudyCharts.tsx`:
- Client component ('use client')
- Render charts_data array: BarChart, LineChart, ScatterChart from Recharts
- Responsive containers
- Colors: #002A5E (navy), #00D26A (green), #FF3B3B (red)

## Tests
- Test: /api/studies returns array (mock NocoDB response)
- Test: StudyCharts renders BarChart for type='bar'
- Test: StudyCharts renders LineChart for type='line'
- Test: StudyCharts handles empty charts_data gracefully

## Acceptance Criteria
- [ ] Data studies visible on /reports page
- [ ] Charts render correctly from JSON data
- [ ] Responsive on mobile
- [ ] ISR caching works
