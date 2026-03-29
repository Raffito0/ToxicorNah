
---

# Section 02 — Chart Generation (generate-chart.js)

## Overview

Create `n8n/code/insiderbuying/generate-chart.js` — 5 chart builders that produce HTML pages with Chart.js loaded via CDN, rendered to PNG through the screenshot server. **No node-canvas, no native dependencies.** Chart.js runs inside the headless Chrome browser that powers the existing screenshot server.

## Dependency

Requires Section 01 (`visual-css.js`) to be complete first.

## File to Create

```
n8n/code/insiderbuying/generate-chart.js
```

## Test File

```
tests/insiderbuying/generate-chart.test.js
```

## Tests to Write First

### HTML Generation Tests (no screenshot server needed)

```
# Test: renderBarChart returns HTML containing <canvas> element
# Test: renderBarChart HTML contains Chart.js CDN script tag
# Test: renderBarChart HTML contains chart config with type "bar"
# Test: renderBarChart includes dataset labels from input
# Test: renderLineChart includes annotation config when annotations provided
# Test: renderLineChart supports dual-axis (two yAxisID configs in output)
# Test: renderLineChart without annotations omits annotation plugin config
# Test: renderRadarChart uses fixed 600x600 dimensions
# Test: renderRadarChart config has type "radar" with correct axis labels
# Test: renderScatterChart config includes xLabel and yLabel in axis options
# Test: renderTableImage generates HTML table with correct number of rows
# Test: renderTableImage applies green tint class for "purchase" type rows
# Test: renderTableImage applies red tint class for "sale" type rows
# Test: renderTableImage escapes HTML in cell values
```

### Screenshot Server Integration Tests (mocked)

```
# Test: chart render calls fetchFn POST to screenshot server URL
# Test: chart render sends { html, viewport, format: 'png' } in POST body
# Test: chart render returns PNG buffer from screenshot server response
# Test: chart render throws on screenshot server 500 error
# Test: chart render throws on non-image response
```

### Input Validation Tests

```
# Test: width > 3000 gets clamped to 3000
# Test: height < 200 gets clamped to 200
# Test: missing datasets throws descriptive Error
# Test: empty labels array throws descriptive Error
```

### Upload Tests

```
# Test: uploadChart calls uploadToR2 with correct key pattern
# Test: uploadChart key contains random suffix (not just timestamp)
# Test: uploadChart returns R2 public URL string
```

Write the test file first, then implement until tests pass. Run: `npm test -- tests/insiderbuying/generate-chart.test.js`

## Architecture

**Critical**: ALL chart rendering goes through the screenshot server. Chart.js runs in headless Chrome, not in Node.js. This eliminates any native dependency (Cairo, Pango, etc.).

### HTML Template Pattern

Every chart builder creates an HTML page like this:

```html
<!DOCTYPE html>
<html><head>
  <style>{BASE_CSS from visual-css.js}</style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3/dist/chartjs-plugin-annotation.min.js"></script>
</head><body style="width:{W}px;height:{H}px;margin:0;background:#0A1128;">
  <canvas id="chart" width="{W}" height="{H}"></canvas>
  <script>
    const ctx = document.getElementById('chart').getContext('2d');
    new Chart(ctx, {CONFIG_JSON});
  </script>
</body></html>
```

The `CONFIG_JSON` is a serialized Chart.js configuration object. The annotation plugin is only included when annotations are needed.

### Screenshot Server Call

Shared internal helper `_renderToBuffer(html, width, height, helpers)`:

```javascript
// POST to screenshot server
// Body: { html, viewport: { width, height }, format: 'png' }
// Verify: response.ok AND response headers Content-Type starts with 'image/'
// Throw on 500 or non-image response
// Return: PNG Buffer
```

Screenshot server URL: `http://host.docker.internal:3456/screenshot`

### Input Validation

Applied in each chart render function:
```javascript
const w = Math.min(Math.max(opts.width || 800, 200), 3000);
const h = Math.min(Math.max(opts.height || 400, 200), 3000);
```

Missing `datasets` or empty `labels` → throw with descriptive message.

## Functions

### `renderBarChart(opts, helpers)` → Promise\<Buffer\>

Input:
```javascript
{
  labels: string[],       // x-axis labels (required)
  datasets: [{            // (required, min 1)
    label: string,
    data: number[],
    backgroundColor?: string,  // default COLORS.blue
  }],
  title?: string,
  width?: number,         // default 800, clamped [200,3000]
  height?: number,        // default 400, clamped [200,3000]
}
```

Chart.js config details:
- `type: 'bar'`
- Grid color: `#2A3548`
- Tick color: `#8892A4` (COLORS.textSecondary)
- Legend color: `#FFFFFF`
- `animation: false` (faster screenshot)
- Responsive: false (explicit dimensions)

### `renderLineChart(opts, helpers)` → Promise\<Buffer\>

Input:
```javascript
{
  labels: string[],
  datasets: [{
    label: string,
    data: number[],
    borderColor?: string,
    yAxisID?: string,        // 'left' or 'right' for dual axis
  }],
  title?: string,
  annotations?: [{
    x: string,              // x-axis label to place the line at
    label: string,          // text label (e.g. "CEO bought here")
    color?: string,         // default COLORS.green
  }],
  width?: number,
  height?: number,
}
```

- Dual-axis support: when any dataset has `yAxisID: 'right'`, include a second y-axis in scales config
- Annotations: each `annotations[i]` → `chartjs-plugin-annotation` vertical line with label. Only include annotation plugin script tag when `opts.annotations` is provided and non-empty.

### `renderRadarChart(opts, helpers)` → Promise\<Buffer\>

Input:
```javascript
{
  labels: string[],         // 6 axis labels
  datasets: [{
    label: string,
    data: number[],          // values 0-100 for each axis
    borderColor?: string,
    backgroundColor?: string,
  }],
  title?: string,
  // width/height always 600x600 — ignore any input
}
```

Always renders at 600x600. Two datasets: subject (#4A9EFF fill, 0.3 opacity) and peer average (gray, 0.15 opacity).

### `renderScatterChart(opts, helpers)` → Promise\<Buffer\>

Input:
```javascript
{
  datasets: [{
    label: string,
    data: [{ x: number, y: number }],
    backgroundColor?: string,
  }],
  xLabel: string,
  yLabel: string,
  title?: string,
  width?: number,
  height?: number,
}
```

`xLabel` and `yLabel` appear as axis titles in the Chart.js config (`scales.x.title.text`, `scales.y.title.text`).

### `renderTableImage(opts, helpers)` → Promise\<Buffer\>

Input:
```javascript
{
  headers: string[],
  rows: [{
    values: string[],
    type?: 'purchase' | 'sale' | null,  // drives row coloring
  }],
  title?: string,
  width?: number,
  height?: number,
}
```

- Generates an HTML table (not Chart.js) — pure HTML/CSS, sent to screenshot server
- Row coloring: `type === 'purchase'` → green tint (`rgba(40,167,69,0.15)` background); `type === 'sale'` → red tint (`rgba(220,53,69,0.15)`)
- All `values` strings wrapped in `escapeHtml()` from `visual-css.js`
- Table styles: dark header (`#1A2238`), border `#2A3548`, Inter font

### `uploadChart(buffer, name, helpers)` → Promise\<string\>

Uploads a PNG buffer to R2 and returns the public URL.

```javascript
// Key pattern: earlyinsider/charts/${name}_${Date.now()}_${randomSuffix(6)}.png
// randomSuffix(6): 6 random alphanumeric chars (Math.random based, not crypto)
// Calls: uploadToR2(buffer, key) from render-pdf.js
// Returns: public R2 URL string
```

The R2 upload uses the existing `uploadToR2` function from `render-pdf.js`. Import it as:
```javascript
const { uploadToR2 } = require('./render-pdf');
```

## CommonJS Pattern

```javascript
'use strict';
const { BASE_CSS, COLORS, escapeHtml } = require('./visual-css');

// ... implementation ...

module.exports = {
  renderBarChart,
  renderLineChart,
  renderRadarChart,
  renderScatterChart,
  renderTableImage,
  uploadChart,
};
```

## Mock Pattern for Tests

```javascript
const mockHelpers = {
  fetchFn: jest.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => 'image/png' },
    buffer: jest.fn().mockResolvedValue(Buffer.from('fake-png')),
  }),
  env: { SCREENSHOT_SERVER_URL: 'http://host.docker.internal:3456' },
  _sleep: jest.fn(),
};
```

## Acceptance Criteria

- [x] All test stubs above pass
- [x] `renderBarChart` HTML contains `cdn.jsdelivr.net/npm/chart.js`
- [x] `renderBarChart` HTML contains `<canvas id="chart"`
- [x] Chart JSON config in HTML has `type: "bar"`
- [x] `renderLineChart` with annotations contains annotation plugin CDN script
- [x] `renderLineChart` without annotations does NOT contain annotation plugin CDN script
- [x] `renderRadarChart` always uses 600x600 viewport regardless of opts
- [x] `renderTableImage` HTML escapes user-provided cell content
- [x] Width 4000 gets clamped to 3000 before render
- [x] `uploadChart` key matches pattern `earlyinsider/charts/${name}_${timestamp}_${6chars}.png`

## Implementation Notes (Actual)

- Files created: `n8n/code/insiderbuying/generate-chart.js`, `tests/insiderbuying/generate-chart.test.js`
- Also modified: `n8n/code/insiderbuying/render-pdf.js` — added `contentType` parameter to `uploadToR2()` (defaults to `'application/pdf'` for backward compat); `uploadChart` passes `'image/png'`
- `renderLineChart` uses `'y'` axis for single-axis charts; `'left'`/`'right'` only when `hasDualAxis === true`
- `renderTableImage` guards against undefined `opts.headers` / `opts.rows`
- 27/27 tests pass
