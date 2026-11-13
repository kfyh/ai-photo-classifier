import React, { useEffect, useRef } from 'react';

interface BlinkiesOverlayProps {
  enabled: boolean;
  imgElement: HTMLImageElement | null;
  imageLoaded: boolean;
  imageKey: string;
  zoomLevel?: number;
  className?: string;
}

/**
 * Renders an on-demand HTML5 <canvas> clipping overlay ("Blinkies") matched to the
 * displayed image's aspect ratio and transform.
 * - Highlight clipping (R >= 250, G >= 250, B >= 250, or L >= 250): Red/Magenta overlay
 * - Shadow clipping (L <= 5): Cyan/Blue overlay
 * Disabled by default; returns null with zero CPU/memory overhead when toggled off.
 */
export const BlinkiesOverlay: React.FC<BlinkiesOverlayProps> = ({
  enabled,
  imgElement,
  imageLoaded,
  imageKey,
  zoomLevel = 1,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled || !imageLoaded || !imgElement || !canvasRef.current) {
      return;
    }

    const natW = imgElement.naturalWidth || imgElement.width || 400;
    const natH = imgElement.naturalHeight || imgElement.height || 300;
    if (natW <= 0 || natH <= 0) return;

    // Downsample analysis grid to max 420px on longest edge for <2ms computation
    // while preserving the exact aspect ratio of the source image so object-contain aligns 1:1.
    const maxSampleDim = 420;
    const scale = Math.min(1, maxSampleDim / Math.max(natW, natH));
    const sampleW = Math.max(1, Math.round(natW * scale));
    const sampleH = Math.max(1, Math.round(natH * scale));

    const canvas = canvasRef.current;
    canvas.width = sampleW;
    canvas.height = sampleH;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    try {
      ctx.clearRect(0, 0, sampleW, sampleH);
      ctx.drawImage(imgElement, 0, 0, sampleW, sampleH);
      const imageData = ctx.getImageData(0, 0, sampleW, sampleH);
      const pixels = imageData.data;

      for (let i = 0; i < pixels.length; i += 4) {
        const a = pixels[i + 3];
        if (a < 128) {
          pixels[i + 3] = 0;
          continue;
        }

        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;

        if (luma >= 250 || r >= 250 || g >= 250 || b >= 250) {
          // Clipped Highlight -> High-visibility Red/Magenta
          pixels[i] = 255;
          pixels[i + 1] = 20;
          pixels[i + 2] = 90;
          pixels[i + 3] = 215;
        } else if (luma <= 5) {
          // Crushed Shadow -> High-visibility Cyan/Blue
          pixels[i] = 0;
          pixels[i + 1] = 215;
          pixels[i + 2] = 255;
          pixels[i + 3] = 215;
        } else {
          // Unclipped tonal range -> Transparent
          pixels[i + 3] = 0;
        }
      }

      ctx.putImageData(imageData, 0, 0);
    } catch {
      // Safely ignore if cross-origin security prevents canvas pixel readback
      ctx.clearRect(0, 0, sampleW, sampleH);
    }
  }, [enabled, imageLoaded, imgElement, imageKey]);

  if (!enabled || !imageLoaded) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none select-none animate-pulse ${className}`}
      style={{
        transform: `scale(${zoomLevel})`,
        transformOrigin: 'center center',
      }}
    />
  );
};
