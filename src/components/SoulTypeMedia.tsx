import { isSoulTypeVideo } from '../data/soulTypes';

interface SoulTypeMediaProps {
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Renders <video> for male Soul Types (.mp4) and <img> for female Soul Types (.png)
 * Videos auto-play, loop, and are muted (required for mobile autoplay)
 */
export function SoulTypeMedia({ src, alt = '', className, style }: SoulTypeMediaProps) {
  if (isSoulTypeVideo(src)) {
    return (
      <video
        src={src}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className={className}
        style={style}
      />
    );
  }
  return <img src={src} alt={alt} className={className} style={style} />;
}
