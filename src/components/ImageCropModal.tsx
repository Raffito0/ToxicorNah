import { useState, useRef, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ImageWithPreview {
  file: File;
  preview: string;
  cropArea: { x: number; y: number; width: number; height: number };
}

interface ImageCropModalProps {
  selectedFiles: File[];
  onConfirm: (files: File[]) => void;
  onCancel: () => void;
}

export function ImageCropModal({ selectedFiles, onConfirm, onCancel }: ImageCropModalProps) {
  const [images, setImages] = useState<ImageWithPreview[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [cropPosition, setCropPosition] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const imageList: ImageWithPreview[] = selectedFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      cropArea: { x: 0, y: 0, width: 100, height: 100 }
    }));
    setImages(imageList);

    return () => {
      imageList.forEach(img => URL.revokeObjectURL(img.preview));
    };
  }, [selectedFiles]);

  const currentImage = images[currentIndex];

  function handleMouseDown(e: React.MouseEvent) {
    setIsDragging(true);
    setDragStart({ x: e.clientX - cropPosition.x, y: e.clientY - cropPosition.y });
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isDragging) return;
    setCropPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  function handleRemoveImage(index: number) {
    const newImages = images.filter((_, i) => i !== index);
    setImages(newImages);

    if (newImages.length === 0) {
      onCancel();
      return;
    }

    if (currentIndex >= newImages.length) {
      setCurrentIndex(newImages.length - 1);
    }
  }

  async function handleConfirm() {
    const croppedFiles = await Promise.all(
      images.map(async (img) => {
        return img.file;
      })
    );
    onConfirm(croppedFiles);
  }

  if (images.length === 0) {
    return null;
  }

  return (
    <motion.div
      className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
      style={{ paddingBottom: '80px' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="w-full max-w-4xl bg-zinc-900 rounded-3xl overflow-hidden"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-white text-xl" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
            Crop & Review Chats
          </h2>
          <button
            onClick={onCancel}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6">
          <div
            className="relative rounded-2xl overflow-hidden mb-6 flex items-center justify-center"
            style={{ height: '400px' }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <AnimatePresence mode="wait">
              {currentImage && (
                <motion.img
                  key={currentIndex}
                  ref={imageRef}
                  src={currentImage.preview}
                  alt="Crop preview"
                  className="max-w-full max-h-full w-auto h-auto cursor-move rounded-2xl object-contain"
                  onMouseDown={handleMouseDown}
                  draggable={false}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                />
              )}
            </AnimatePresence>
          </div>

          <div className="flex gap-3 mb-6 overflow-x-auto pb-2 pt-2 px-2">
            {images.map((img, index) => (
              <div
                key={index}
                className={`relative flex-shrink-0 cursor-pointer transition-all p-2 ${
                  index === currentIndex ? 'ring-2 ring-blue-500 rounded-lg' : ''
                }`}
                onClick={() => setCurrentIndex(index)}
              >
                <img
                  src={img.preview}
                  alt={`Thumbnail ${index + 1}`}
                  className="h-20 w-auto object-cover rounded-lg"
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveImage(index);
                  }}
                  className="absolute top-0 right-0 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-3 justify-center">
            <button
              onClick={onCancel}
              className="bg-zinc-800 text-white rounded-full font-medium hover:bg-zinc-700 transition-colors px-[15px] h-[40px]"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="text-white rounded-full font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 px-[15px] h-[40px]"
              style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px', background: 'linear-gradient(135deg, #B794F4 0%, #8B5CF6 100%)' }}
            >
              <Check className="w-5 h-5" />
              Confirm {images.length} chat{images.length > 1 ? 's' : ''}
            </button>
          </div>
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </motion.div>
    </motion.div>
  );
}
