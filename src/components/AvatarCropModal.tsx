import { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface AvatarCropModalProps {
  imageSrc: string;
  onConfirm: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

const CIRCLE_SIZE = 260;

function clampPos(x: number, y: number, imgW: number, imgH: number) {
  return {
    x: Math.min(0, Math.max(CIRCLE_SIZE - imgW, x)),
    y: Math.min(0, Math.max(CIRCLE_SIZE - imgH, y)),
  };
}

export function AvatarCropModal({ imageSrc, onConfirm, onCancel }: AvatarCropModalProps) {
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const isDragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef<number | null>(null);
  const stateRef = useRef({ scale: 1, pos: { x: 0, y: 0 }, naturalW: 0, naturalH: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Keep ref in sync with state (avoids stale closures in event handlers)
  useEffect(() => { stateRef.current.scale = scale; }, [scale]);
  useEffect(() => { stateRef.current.pos = pos; }, [pos]);
  useEffect(() => { stateRef.current.naturalW = naturalW; stateRef.current.naturalH = naturalH; }, [naturalW, naturalH]);

  // Block body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setNaturalW(w);
      setNaturalH(h);
      // Scale so image covers the circle on BOTH axes (use max ratio, not min)
      const initScale = Math.max(CIRCLE_SIZE / w, CIRCLE_SIZE / h);
      const iw = w * initScale;
      const ih = h * initScale;
      const initPos = clampPos(-(iw - CIRCLE_SIZE) / 2, -(ih - CIRCLE_SIZE) / 2, iw, ih);
      setScale(initScale);
      setPos(initPos);
      stateRef.current = { scale: initScale, pos: initPos, naturalW: w, naturalH: h };
    };
    img.src = imageSrc;
  }, [imageSrc]);

  function applyScale(newScale: number, pivotX = CIRCLE_SIZE / 2, pivotY = CIRCLE_SIZE / 2) {
    const { scale: oldScale, pos: oldPos, naturalW: nw, naturalH: nh } = stateRef.current;
    const minScale = CIRCLE_SIZE / Math.min(nw, nh);
    const s = Math.min(5, Math.max(minScale, newScale));
    // Zoom towards pivot point
    const ratio = s / oldScale;
    const newX = pivotX - ratio * (pivotX - oldPos.x);
    const newY = pivotY - ratio * (pivotY - oldPos.y);
    const clamped = clampPos(newX, newY, nw * s, nh * s);
    setScale(s);
    setPos(clamped);
    stateRef.current.scale = s;
    stateRef.current.pos = clamped;
  }

  function onPointerDown(e: React.PointerEvent) {
    isDragging.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!isDragging.current) return;
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    const { pos: p, scale: s, naturalW: nw, naturalH: nh } = stateRef.current;
    const clamped = clampPos(p.x + dx, p.y + dy, nw * s, nh * s);
    setPos(clamped);
    stateRef.current.pos = clamped;
  }

  function onPointerUp() {
    isDragging.current = false;
  }

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 1) {
      isDragging.current = true;
      lastPointer.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      isDragging.current = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    e.preventDefault();
    if (e.touches.length === 1 && isDragging.current) {
      const dx = e.touches[0].clientX - lastPointer.current.x;
      const dy = e.touches[0].clientY - lastPointer.current.y;
      lastPointer.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      const { pos: p, scale: s, naturalW: nw, naturalH: nh } = stateRef.current;
      const clamped = clampPos(p.x + dx, p.y + dy, nw * s, nh * s);
      setPos(clamped);
      stateRef.current.pos = clamped;
    } else if (e.touches.length === 2 && lastPinchDist.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ratio = dist / lastPinchDist.current;
      lastPinchDist.current = dist;
      applyScale(stateRef.current.scale * ratio);
    }
  }

  function onTouchEnd() {
    isDragging.current = false;
    lastPinchDist.current = null;
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.08 : 0.93;
    applyScale(stateRef.current.scale * delta);
  }

  function handleConfirm() {
    const canvas = canvasRef.current;
    if (!canvas || naturalW === 0) return;
    canvas.width = CIRCLE_SIZE;
    canvas.height = CIRCLE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(CIRCLE_SIZE / 2, CIRCLE_SIZE / 2, CIRCLE_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, pos.x, pos.y, naturalW * scale, naturalH * scale);
      onConfirm(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.src = imageSrc;
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', background: 'rgba(0,0,0,0.55)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <motion.div
        className="relative rounded-3xl overflow-hidden flex flex-col"
        style={{
          width: 340,
          background: '#111111',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
        }}
        initial={{ scale: 0.88, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.88, opacity: 0, y: 20 }}
        transition={{ duration: 0.28, ease: [0.34, 1.56, 0.64, 1] }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <button onClick={onCancel} className="text-zinc-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
          <span className="text-white text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 300, letterSpacing: '1.5px' }}>
            Move and Scale
          </span>
          <button
            onClick={handleConfirm}
            className="text-white text-sm px-4 py-1.5 rounded-full"
            style={{ background: 'linear-gradient(135deg, #7C4DFF, #6200EA)', fontFamily: 'Plus Jakarta Sans, sans-serif', letterSpacing: '1px' }}
          >
            Choose
          </button>
        </div>

        {/* Crop area */}
        <div
          className="flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
          style={{ height: CIRCLE_SIZE + 40, background: '#111111', touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Circle clipping container */}
          <div
            style={{
              width: CIRCLE_SIZE,
              height: CIRCLE_SIZE,
              borderRadius: '50%',
              overflow: 'hidden',
              position: 'relative',
              flexShrink: 0,
              border: '1.5px solid rgba(255,255,255,0.25)',
            }}
          >
            {naturalW > 0 && (
              <img
                src={imageSrc}
                draggable={false}
                style={{
                  position: 'absolute',
                  left: pos.x,
                  top: pos.y,
                  width: naturalW * scale,
                  height: naturalH * scale,
                  userSelect: 'none',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        </div>

        <div className="pb-4" />
      </motion.div>

      <canvas ref={canvasRef} className="hidden" />
    </motion.div>
  );
}
