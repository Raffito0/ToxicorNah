import { useRef, useEffect, useState, useCallback } from 'react';

interface ScratchRevealProps {
  children: React.ReactNode;
  brushSize?: number;
  revealThreshold?: number;
  onRevealComplete?: () => void;
  onScratchProgress?: (progress: number) => void;
  className?: string;
}

export function ScratchReveal({
  children,
  brushSize = 40,
  revealThreshold = 60,
  onRevealComplete,
  onScratchProgress,
  className = ''
}: ScratchRevealProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [isScratching, setIsScratching] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  // Initialize canvas after mount
  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 10;

    function tryInit() {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!canvas || !container) {
        if (attempts < maxAttempts) {
          attempts++;
          requestAnimationFrame(tryInit);
        }
        return;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const rect = container.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      if (width === 0 || height === 0) {
        if (attempts < maxAttempts) {
          attempts++;
          requestAnimationFrame(tryInit);
        }
        return;
      }

      // Set canvas size (2x for retina displays)
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);

      // Fill with dark overlay
      ctx.fillStyle = 'rgba(20, 20, 35, 0.97)';
      ctx.fillRect(0, 0, width, height);

      // Shimmer gradient
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.02)');
      gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.06)');
      gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.02)');
      gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.06)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // "Scratch to reveal" text
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = 'bold 13px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SCRATCH TO REVEAL', width / 2, height / 2 - 12);

      ctx.font = '22px sans-serif';
      ctx.fillText('✨', width / 2, height / 2 + 18);

      setCanvasReady(true);
    }

    requestAnimationFrame(tryInit);
  }, []);

  // Calculate reveal percentage
  const calculateRevealProgress = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;

    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    let transparentPixels = 0;
    const totalPixels = canvas.width * canvas.height;

    // Sample every 4th pixel for performance
    for (let i = 3; i < pixels.length; i += 16) {
      if (pixels[i] === 0) {
        transparentPixels += 4;
      }
    }

    return (transparentPixels / totalPixels) * 100;
  }, []);

  // Scratch function
  const scratch = useCallback((x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas || isRevealed || !canvasReady) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const canvasX = (x - rect.left) * dpr;
    const canvasY = (y - rect.top) * dpr;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';

    const scaledBrush = brushSize * dpr;

    // Draw line from last point
    if (lastPointRef.current) {
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(canvasX, canvasY);
      ctx.lineWidth = scaledBrush;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // Draw circle at current point
    ctx.beginPath();
    ctx.arc(canvasX, canvasY, scaledBrush / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    lastPointRef.current = { x: canvasX, y: canvasY };

    // Haptic
    if (navigator.vibrate) {
      navigator.vibrate(5);
    }

    // Check progress
    const progress = calculateRevealProgress();
    onScratchProgress?.(progress);

    if (progress >= revealThreshold && !isRevealed) {
      setIsRevealed(true);
      onRevealComplete?.();
      if (navigator.vibrate) {
        navigator.vibrate([50, 30, 50]);
      }
    }
  }, [brushSize, calculateRevealProgress, isRevealed, canvasReady, onRevealComplete, onScratchProgress, revealThreshold]);

  // Mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsScratching(true);
    lastPointRef.current = null;
    scratch(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isScratching) return;
    scratch(e.clientX, e.clientY);
  };

  const handleMouseUp = () => {
    setIsScratching(false);
    lastPointRef.current = null;
  };

  // Touch events
  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    setIsScratching(true);
    lastPointRef.current = null;
    const touch = e.touches[0];
    scratch(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    if (!isScratching) return;
    const touch = e.touches[0];
    scratch(touch.clientX, touch.clientY);
  };

  const handleTouchEnd = () => {
    setIsScratching(false);
    lastPointRef.current = null;
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Content underneath */}
      <div className="relative">
        {children}
      </div>

      {/* Scratch overlay canvas */}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 cursor-pointer transition-opacity duration-500 z-30 ${
          isRevealed ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
        style={{
          touchAction: 'none',
          borderRadius: '28px',
          display: canvasReady ? 'block' : 'none'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
    </div>
  );
}
