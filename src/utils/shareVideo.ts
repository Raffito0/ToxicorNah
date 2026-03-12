/**
 * Generates a 6-second shareable video by compositing Soul Type video
 * with overlay (logo, gradient, glassmorphism, title, tagline, score badge).
 * Uses Canvas API + MediaRecorder.
 */

// Score color (matches personProfileService.ts getScoreColor)
function getScoreColor(score: number): string {
  if (score <= 30) return '#4ade80';
  if (score <= 60) return '#facc15';
  return '#ef4444';
}

// Toxicity label (matches PersonProfile.tsx getToxicityLabel)
function getToxicityLabel(score: number): string {
  if (score <= 30) return 'Barely a Red Flag';
  if (score <= 50) return 'Low-key Toxic';
  if (score <= 65) return 'Certified Toxic';
  if (score <= 80) return 'Dangerously Toxic';
  return 'Run.';
}

export interface ShareVideoParams {
  videoSrc: string;
  title: string;
  tagline: string;
  score: number;
  duration?: number; // ms, default 6000
}

export async function generateShareVideo({
  videoSrc,
  title,
  tagline,
  score,
  duration = 6000,
}: ShareVideoParams, imageOnly = false): Promise<Blob> {
  // ---- Layout constants (2x scale for quality) ----
  // Logo is now INSIDE the card, so container = just padding + card
  const S = 2;
  const containerW = 340 * S;
  const pad = 12 * S;
  const cardW = containerW - pad * 2; // 632
  const cardH = Math.round(cardW * 16 / 9); // ~1124
  const cardR = 24 * S; // rounded corners
  const containerH = pad + cardH + pad;
  const cardX = pad;
  const cardY = pad;

  // ---- Load resources in parallel ----
  const [videoEl, logoImg] = await Promise.all([
    loadVideo(videoSrc),
    loadImage('/logo-group59.png'),
  ]);

  // ---- Create canvas ----
  const canvas = document.createElement('canvas');
  canvas.width = containerW;
  canvas.height = containerH;
  const ctx = canvas.getContext('2d')!;

  // ---- Pre-render one blurred frame for glassmorphism ----
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = cardW;
  blurCanvas.height = cardH;
  const blurCtx = blurCanvas.getContext('2d')!;

  function updateBlurFrame() {
    blurCtx.filter = 'blur(40px)';
    blurCtx.drawImage(videoEl, 0, 0, cardW, cardH);
    blurCtx.filter = 'none';
  }
  // Capture initial blur frame
  updateBlurFrame();

  // ---- Pre-compute text layout ----
  const titleFont = `${500} ${31 * S}px Outfit, sans-serif`;
  const taglineFont = `${200} ${18 * S}px "Plus Jakarta Sans", sans-serif`;
  const labelFont = `bold ${19 * S}px Satoshi, sans-serif`;
  const subLabelFont = `${200} ${13 * S}px "Plus Jakarta Sans", sans-serif`;
  const scoreFont = `${400} ${16 * S}px "Plus Jakarta Sans", sans-serif`;

  const toxLabel = getToxicityLabel(score);
  const orbSize = 46 * S;
  const orbColor = getScoreColor(score);

  // ---- Draw one frame ----
  function drawFrame() {
    ctx.clearRect(0, 0, containerW, containerH);

    // Background
    ctx.fillStyle = '#0a0a0a';
    roundRect(ctx, 0, 0, containerW, containerH, 32 * S);
    ctx.fill();

    // Card background (clipped rounded rect)
    ctx.save();
    roundRectClip(ctx, cardX, cardY, cardW, cardH, cardR);

    // Draw video frame
    // Cover-fit the video into the card
    drawCover(ctx, videoEl, cardX, cardY, cardW, cardH);

    // Gradient overlay: transparent → rgba(0,0,0,0.8)
    const grad = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardH);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.3, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = grad;
    ctx.fillRect(cardX, cardY, cardW, cardH);

    // Glassmorphism: bottom 45% — draw blurred video + dark overlay
    const glassH = Math.round(cardH * 0.45);
    const glassY = cardY + cardH - glassH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cardX, glassY, cardW, glassH);
    ctx.clip();
    // Draw blurred video frame
    ctx.drawImage(blurCanvas, cardX, cardY, cardW, cardH);
    // Dark semi-transparent overlay
    const glassMask = ctx.createLinearGradient(cardX, glassY, cardX, glassY + glassH);
    glassMask.addColorStop(0, 'rgba(0,0,0,0)');
    glassMask.addColorStop(0.4, 'rgba(0,0,0,0.35)');
    glassMask.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = glassMask;
    ctx.fillRect(cardX, glassY, cardW, glassH);
    ctx.restore();

    ctx.restore(); // end card clip

    // ---- Text content (bottom of card) ----
    const contentBottom = cardY + cardH - 8 * S; // pb-8
    const contentCenterX = cardX + cardW / 2;

    // Toxic score badge area
    const badgeY = contentBottom - 20 * S; // approximate bottom of badge
    const orbCenterY = badgeY - orbSize / 2;
    const orbCenterX = contentCenterX - 60 * S; // offset left for text

    // Draw orb (simplified colored circle)
    ctx.beginPath();
    ctx.arc(orbCenterX, orbCenterY, orbSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = orbColor;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Score number inside orb
    ctx.font = scoreFont;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(score), orbCenterX, orbCenterY);

    // Label text to the right of orb
    const labelX = orbCenterX + orbSize / 2 + 10 * S;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = labelFont;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(toxLabel, labelX, orbCenterY - 9 * S);
    ctx.font = subLabelFont;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('Toxicity Score', labelX, orbCenterY + 12 * S);

    // Logo inside card (below score badge)
    const logoInCardH = 28 * S;
    const logoScale = logoInCardH / logoImg.naturalHeight;
    const logoW = logoImg.naturalWidth * logoScale;
    const logoX = contentCenterX - logoW / 2;
    const logoY = orbCenterY + orbSize / 2 + 10 * S;
    ctx.drawImage(logoImg, logoX, logoY, logoW, logoInCardH);

    // Tagline (above badge)
    const taglineY = orbCenterY - orbSize / 2 - 16 * S;
    ctx.font = taglineFont;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(tagline, contentCenterX, taglineY);

    // Title (above tagline)
    const titleY = taglineY - 8 * S;
    ctx.font = titleFont;
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'bottom';
    ctx.letterSpacing = '3px';
    ctx.fillText(title, contentCenterX, titleY);
  }

  // ---- Image-only mode: single frame PNG export ----
  if (imageOnly) {
    drawFrame();
    videoEl.pause();
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image export failed')), 'image/png');
    });
  }

  // ---- Record video ----
  const fps = 30;
  const stream = canvas.captureStream(fps);

  // Try mp4 first, fall back to webm
  const mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')
    ? 'video/mp4;codecs=avc1'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const recordingDone = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      const ext = mimeType.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
      resolve(new Blob(chunks, { type: ext }));
    };
  });

  recorder.start();

  // Animation loop
  const startTime = performance.now();
  let blurUpdateCounter = 0;

  await new Promise<void>((resolve) => {
    function tick() {
      const elapsed = performance.now() - startTime;
      if (elapsed >= duration) {
        recorder.stop();
        resolve();
        return;
      }
      // Update blur frame every 15 frames (~0.5s) for performance
      blurUpdateCounter++;
      if (blurUpdateCounter % 15 === 0) updateBlurFrame();

      drawFrame();
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });

  return recordingDone;
}

// ---- Dynamic Card Share Video ----

export interface DynamicShareVideoParams {
  personImageSrc: string;
  userImageSrc: string;
  dynamicName: string;
  subtitle: string;
  personSoulType: string;
  userSoulType: string;
  duration?: number; // ms, default 6000
}

export async function generateDynamicShareVideo({
  personImageSrc,
  userImageSrc,
  dynamicName,
  subtitle,
  personSoulType,
  userSoulType,
  duration = 6000,
}: DynamicShareVideoParams, imageOnly = false): Promise<Blob> {
  const S = 2;
  const containerW = 340 * S;
  const pad = 12 * S;
  const cardW = containerW - pad * 2;
  const cardH = Math.round(cardW * 16 / 9);
  const cardR = 24 * S;
  const containerH = pad + cardH + pad;
  const cardX = pad;
  const cardY = pad;

  // Load resources in parallel
  const [personImg, userImg, logoImg] = await Promise.all([
    loadImage(personImageSrc),
    loadImage(userImageSrc),
    loadImage('/logo-group59.png'),
  ]);

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = containerW;
  canvas.height = containerH;
  const ctx = canvas.getContext('2d')!;

  // Pre-render blurred composite for glassmorphism
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = cardW;
  blurCanvas.height = cardH;
  const blurCtx = blurCanvas.getContext('2d')!;

  // Draw both images with lighten blend into blur canvas
  function drawBlendedImages(targetCtx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    targetCtx.save();
    targetCtx.globalCompositeOperation = 'source-over';
    // Fill black background first (lighten blend needs dark base)
    targetCtx.fillStyle = '#111111';
    targetCtx.fillRect(x, y, w, h);
    // Draw person image (left-aligned)
    drawCoverWithPosition(targetCtx, personImg, x, y, w, h, 'left center');
    // Draw user image with lighten blend (right-aligned)
    targetCtx.globalCompositeOperation = 'lighten';
    drawCoverWithPosition(targetCtx, userImg, x, y, w, h, 'right center');
    targetCtx.globalCompositeOperation = 'source-over';
    targetCtx.restore();
  }

  // Blur version
  blurCtx.filter = 'blur(40px)';
  drawBlendedImages(blurCtx, 0, 0, cardW, cardH);
  blurCtx.filter = 'none';

  // Text fonts
  const titleFont = `500 ${28 * S}px Outfit, sans-serif`;
  const subtitleFont = `200 ${14 * S}px "Plus Jakarta Sans", sans-serif`;
  const labelFont = `200 ${9 * S}px "Plus Jakarta Sans", sans-serif`;
  const typeFont = `400 ${14 * S}px Outfit, sans-serif`;

  function drawFrame() {
    ctx.clearRect(0, 0, containerW, containerH);

    // Background
    ctx.fillStyle = '#0a0a0a';
    roundRect(ctx, 0, 0, containerW, containerH, 32 * S);
    ctx.fill();

    // Card (clipped)
    ctx.save();
    roundRectClip(ctx, cardX, cardY, cardW, cardH, cardR);

    // Draw blended images
    drawBlendedImages(ctx, cardX, cardY, cardW, cardH);

    // Glassmorphism: bottom 50%
    const glassH = Math.round(cardH * 0.50);
    const glassY = cardY + cardH - glassH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cardX, glassY, cardW, glassH);
    ctx.clip();
    ctx.drawImage(blurCanvas, cardX, cardY, cardW, cardH);
    const glassMask = ctx.createLinearGradient(cardX, glassY, cardX, glassY + glassH);
    glassMask.addColorStop(0, 'rgba(0,0,0,0)');
    glassMask.addColorStop(0.5, 'rgba(0,0,0,0.35)');
    glassMask.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = glassMask;
    ctx.fillRect(cardX, glassY, cardW, glassH);
    ctx.restore();

    // Dark gradient overlay (bottom 45%)
    const gradH = Math.round(cardH * 0.45);
    const gradY = cardY + cardH - gradH;
    const grad = ctx.createLinearGradient(cardX, gradY, cardX, cardY + cardH);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.4, 'rgba(0,0,0,0.3)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.6)');
    grad.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = grad;
    ctx.fillRect(cardX, gradY, cardW, gradH);

    ctx.restore(); // end card clip

    // ---- Text content ----
    const contentCenterX = cardX + cardW / 2;
    const contentBottom = cardY + cardH - 8 * S;

    // Logo at very bottom
    const logoH = 24 * S;
    const logoScale = logoH / logoImg.naturalHeight;
    const logoW = logoImg.naturalWidth * logoScale;
    const logoX = contentCenterX - logoW / 2;
    const logoY = contentBottom - logoH;
    ctx.drawImage(logoImg, logoX, logoY, logoW, logoH);

    // Soul Type blocks (above logo)
    const blocksY = logoY - 20 * S;
    const blockW = 120 * S;
    const dividerX = contentCenterX;
    const leftBlockX = dividerX - 10 * S - blockW / 2;
    const rightBlockX = dividerX + 10 * S + blockW / 2;

    // Divider line
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1 * S;
    ctx.beginPath();
    ctx.moveTo(dividerX, blocksY - 30 * S);
    ctx.lineTo(dividerX, blocksY + 6 * S);
    ctx.stroke();

    // His Soul Type (left)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = typeFont;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(personSoulType, leftBlockX, blocksY);
    ctx.font = labelFont;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('HIS SOUL TYPE', leftBlockX, blocksY - 18 * S);

    // Your Soul Type (right)
    ctx.font = typeFont;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(userSoulType, rightBlockX, blocksY);
    ctx.font = labelFont;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('YOUR SOUL TYPE', rightBlockX, blocksY - 18 * S);

    // Subtitle (above soul type blocks)
    const subtitleY = blocksY - 46 * S;
    ctx.font = subtitleFont;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(subtitle, contentCenterX, subtitleY);

    // Dynamic Name (above subtitle)
    const titleY = subtitleY - 8 * S;
    ctx.font = titleFont;
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'bottom';
    ctx.fillText(dynamicName, contentCenterX, titleY);
  }

  // Image-only mode: single frame PNG export
  if (imageOnly) {
    drawFrame();
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image export failed')), 'image/png');
    });
  }

  // Record video
  const fps = 30;
  const stream = canvas.captureStream(fps);
  const mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')
    ? 'video/mp4;codecs=avc1'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const recordingDone = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      const ext = mimeType.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
      resolve(new Blob(chunks, { type: ext }));
    };
  });

  recorder.start();

  const startTime = performance.now();
  await new Promise<void>((resolve) => {
    function tick() {
      const elapsed = performance.now() - startTime;
      if (elapsed >= duration) {
        recorder.stop();
        resolve();
        return;
      }
      drawFrame();
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });

  return recordingDone;
}

/** Generate a single-frame PNG image of the Soul Type share card. */
export function generateShareImage(params: Omit<ShareVideoParams, 'duration'>): Promise<Blob> {
  return generateShareVideo({ ...params }, true);
}

/** Generate a single-frame PNG image of the Dynamic share card. */
export function generateDynamicShareImage(params: Omit<DynamicShareVideoParams, 'duration'>): Promise<Blob> {
  return generateDynamicShareVideo({ ...params }, true);
}

/** Draw image in cover mode with object-position support */
function drawCoverWithPosition(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number, dy: number, dw: number, dh: number,
  position: string,
) {
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const scale = Math.max(dw / sw, dh / sh);
  const tw = sw * scale;
  const th = sh * scale;
  // Parse position
  let tx = dx + (dw - tw) / 2;
  const ty = dy + (dh - th) / 2;
  if (position.includes('left')) tx = dx;
  else if (position.includes('right')) tx = dx + dw - tw;
  ctx.drawImage(img, tx, ty, tw, th);
}

// ---- Helpers ----

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = src;
    video.onloadeddata = () => {
      video.currentTime = 0;
      video.play().then(() => resolve(video)).catch(reject);
    };
    video.onerror = () => reject(new Error(`Failed to load video: ${src}`));
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/** Draw image in cover mode (fill area, crop overflow) */
function drawCover(
  ctx: CanvasRenderingContext2D,
  source: HTMLVideoElement | HTMLImageElement,
  dx: number, dy: number, dw: number, dh: number
) {
  const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  const scale = Math.max(dw / sw, dh / sh);
  const tw = sw * scale;
  const th = sh * scale;
  const tx = dx + (dw - tw) / 2;
  const ty = dy + (dh - th) / 2;
  ctx.drawImage(source, tx, ty, tw, th);
}

/** Create a rounded rectangle path */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Clip to a rounded rectangle */
function roundRectClip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
}
