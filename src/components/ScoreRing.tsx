import { useEffect, useState, useRef } from 'react';

interface ScoreRingProps {
  score: number;
  maxScore?: number;
  onColorCalculated?: (color: string) => void;
}

export function getColorAtPercentage(percentage: number): string {
  const t = percentage;

  if (t < 0.25) {
    const localT = t / 0.25;
    return interpolateColor('#4ade80', '#fbbf24', localT);
  } else if (t < 0.5) {
    const localT = (t - 0.25) / 0.25;
    return interpolateColor('#fbbf24', '#ff6b35', localT);
  } else if (t < 0.75) {
    const localT = (t - 0.5) / 0.25;
    return interpolateColor('#ff6b35', '#ef4444', localT);
  } else {
    return '#ef4444';
  }
}

function interpolateColor(color1: string, color2: string, t: number): string {
  const r1 = parseInt(color1.slice(1, 3), 16);
  const g1 = parseInt(color1.slice(3, 5), 16);
  const b1 = parseInt(color1.slice(5, 7), 16);

  const r2 = parseInt(color2.slice(1, 3), 16);
  const g2 = parseInt(color2.slice(3, 5), 16);
  const b2 = parseInt(color2.slice(5, 7), 16);

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);

  return `rgb(${r}, ${g}, ${b})`;
}

export function ScoreRing({ score, maxScore = 100, onColorCalculated }: ScoreRingProps) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const radius = 76;
  const strokeWidth = 14;

  useEffect(() => {
    const duration = 2000;
    const steps = 60;
    const increment = score / steps;
    let current = 0;

    const timer = setInterval(() => {
      current += increment;
      if (current >= score) {
        setAnimatedScore(score);
        clearInterval(timer);
      } else {
        setAnimatedScore(Math.floor(current));
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [score]);

  useEffect(() => {
    if (onColorCalculated && animatedScore > 0) {
      const percentage = animatedScore / maxScore;
      const color = getColorAtPercentage(percentage);
      onColorCalculated(color);
    }
  }, [animatedScore, maxScore, onColorCalculated]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const percentage = animatedScore / maxScore;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw the full gray background ring
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#171717';
    ctx.lineWidth = strokeWidth;
    ctx.stroke();

    // Draw the gradient ring only up to the score percentage
    const segments = 360;
    const totalSegments = Math.floor(segments * percentage);

    for (let i = 0; i < totalSegments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const nextAngle = ((i + 1) / segments) * Math.PI * 2;

      const t = i / segments;
      const color = getColorAtPercentage(t);

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, angle - Math.PI / 2, nextAngle - Math.PI / 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
  }, [animatedScore, maxScore]);

  return (
    <div className="relative w-52 h-52 mx-auto mb-3">
      <canvas
        ref={canvasRef}
        width={208}
        height={208}
        className="absolute inset-0"
      />
      
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
        <div className="text-[42px] text-white leading-none" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
          {animatedScore}
        </div>
        <div className="text-[13px] text-[#747474] mt-1">/{maxScore}</div>
      </div>
    </div>
  );
}