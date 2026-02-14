/**
 * Color utility functions for computing dynamic gradients
 * based on archetype color similarity.
 */

export function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '');
  return [
    parseInt(cleaned.slice(0, 2), 16),
    parseInt(cleaned.slice(2, 4), 16),
    parseInt(cleaned.slice(4, 6), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [clamp(r), clamp(g), clamp(b)]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('');
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
      case g: h = ((b - r) / d + 2) * 60; break;
      case b: h = ((r - g) / d + 4) * 60; break;
    }
  }
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const val = Math.round(l * 255);
    return [val, val, val];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hNorm = h / 360;
  return [
    Math.round(hue2rgb(p, q, hNorm + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hNorm) * 255),
    Math.round(hue2rgb(p, q, hNorm - 1 / 3) * 255),
  ];
}

/**
 * Weighted Euclidean distance in RGB space.
 * Human eye is more sensitive to green, hence higher weight.
 */
export function colorDistance(hex1: string, hex2: string): number {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return Math.sqrt(
    2 * (r1 - r2) ** 2 +
    4 * (g1 - g2) ** 2 +
    3 * (b1 - b2) ** 2
  );
}

/**
 * Finds the most similar color between two sets, weighted by dominance.
 * Colors at index 0 are considered most dominant and get priority.
 * Returns the average of the two closest colors.
 */
export function findMostSimilarColor(
  colorsA: string[],
  colorsB: string[]
): string {
  // Weight multipliers: lower = more likely to be picked
  // Index 0 (most dominant) gets 0.6x, index 1 gets 1.0x, index 2 gets 1.4x
  const weights = [0.6, 1.0, 1.4];

  let minDistance = Infinity;
  let bestA = colorsA[0];
  let bestB = colorsB[0];

  for (let i = 0; i < colorsA.length; i++) {
    for (let j = 0; j < colorsB.length; j++) {
      const dist = colorDistance(colorsA[i], colorsB[j]);
      const weightedDist = dist * (weights[i] + weights[j]) / 2;
      if (weightedDist < minDistance) {
        minDistance = weightedDist;
        bestA = colorsA[i];
        bestB = colorsB[j];
      }
    }
  }

  const [r1, g1, b1] = hexToRgb(bestA);
  const [r2, g2, b2] = hexToRgb(bestB);
  return rgbToHex(
    (r1 + r2) / 2,
    (g1 + g2) / 2,
    (b1 + b2) / 2
  );
}

/**
 * Generates a dark gradient from a base color.
 * - Start (lighter): L = 0.18
 * - End (darker): L = 0.07
 * Both shades remain dark/elegant for the UI.
 */
export function generateDarkGradient(baseHex: string): { start: string; end: string } {
  const [r, g, b] = hexToRgb(baseHex);
  const [h, s] = rgbToHsl(r, g, b);

  const lighterS = Math.min(1, s * 1.2 + 0.1);
  const lighterL = 0.18;

  const darkerS = Math.min(1, s * 1.1 + 0.05);
  const darkerL = 0.07;

  const [lr, lg, lb] = hslToRgb(h, lighterS, lighterL);
  const [dr, dg, db] = hslToRgb(h, darkerS, darkerL);

  return {
    start: rgbToHex(lr, lg, lb),
    end: rgbToHex(dr, dg, db),
  };
}
