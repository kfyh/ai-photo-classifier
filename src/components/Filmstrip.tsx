import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CombinedPhotoData } from '../types';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { getPhotoSrc, useResolvedThumbnails } from '../utils/image';

interface FilmstripProps {
  photos: CombinedPhotoData[];
  selectedPhotoId: string | null;
  onSelectPhoto: (photo: CombinedPhotoData) => void;
}

const ITEM_WIDTH_PX = 56; // w-14 = 56px
const ITEM_GAP_PX = 8; // gap-2 = 8px
const ITEM_STRIDE_PX = ITEM_WIDTH_PX + ITEM_GAP_PX;
const OVERSCAN_ITEMS = 6;

export const Filmstrip: React.FC<FilmstripProps> = ({
  photos,
  selectedPhotoId,
  onSelectPhoto,
}) => {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [failedThumbIds, setFailedThumbIds] = useState<Set<string>>(new Set());
  const requestedPriorityIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;

    const updateWidth = () => {
      setContainerWidth(el.clientWidth || 1200);
    };

    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateWidth);
      observer.observe(el);
      return () => observer.disconnect();
    } else {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(e.currentTarget.scrollLeft);
  }, []);

  // Compute horizontal virtualized window
  const windowMetrics = useMemo(() => {
    const visibleStart = Math.max(0, Math.floor(scrollLeft / ITEM_STRIDE_PX));
    const visibleCount = Math.ceil(containerWidth / ITEM_STRIDE_PX);
    const startIndex = Math.max(0, visibleStart - OVERSCAN_ITEMS);
    const endIndex = Math.min(photos.length, visibleStart + visibleCount + OVERSCAN_ITEMS);

    const leftSpacerWidth = startIndex * ITEM_STRIDE_PX;
    const rightSpacerWidth = Math.max(0, (photos.length - endIndex) * ITEM_STRIDE_PX);

    return {
      startIndex,
      endIndex,
      leftSpacerWidth,
      rightSpacerWidth,
    };
  }, [photos.length, scrollLeft, containerWidth]);

  const pooledPhotos = useMemo(() => {
    return photos.slice(windowMetrics.startIndex, windowMetrics.endIndex);
  }, [photos, windowMetrics.startIndex, windowMetrics.endIndex]);

  useResolvedThumbnails(pooledPhotos);

  // Keep active photo visible in the horizontal filmstrip when cycling photos
  useEffect(() => {
    if (!selectedPhotoId || !stripRef.current || photos.length === 0) return;
    const idx = photos.findIndex(p => p.photo.id === selectedPhotoId);
    if (idx < 0) return;

    const itemLeft = idx * ITEM_STRIDE_PX;
    const itemRight = itemLeft + ITEM_WIDTH_PX;
    const el = stripRef.current;

    if (itemLeft < el.scrollLeft) {
      el.scrollTo({ left: Math.max(0, itemLeft - ITEM_STRIDE_PX), behavior: 'smooth' });
    } else if (itemRight > el.scrollLeft + el.clientWidth) {
      el.scrollTo({
        left: itemRight - el.clientWidth + ITEM_STRIDE_PX,
        behavior: 'smooth',
      });
    }
  }, [selectedPhotoId, photos]);

  // Prioritize visible filmstrip thumbnails if any are not yet generated
  useEffect(() => {
    if (!window.api?.prioritizeThumbnails || pooledPhotos.length === 0) return;
    const missingIds = pooledPhotos
      .filter(
        item => !item.photo.thumbnail_path && !requestedPriorityIdsRef.current.has(item.photo.id)
      )
      .map(item => item.photo.id);
    if (missingIds.length === 0) return;

    const timer = setTimeout(() => {
      for (const id of missingIds) {
        requestedPriorityIdsRef.current.add(id);
      }
      window.api?.prioritizeThumbnails(missingIds);
    }, 50);

    return () => clearTimeout(timer);
  }, [pooledPhotos]);

  if (photos.length === 0) return null;

  return (
    <div
      ref={stripRef}
      onScroll={handleScroll}
      className="h-20 bg-[#141519] border-t border-[#2a2d3a] px-3 flex items-center gap-2 overflow-x-auto z-20 flex-shrink-0"
    >
      {windowMetrics.leftSpacerWidth > 0 && (
        <div
          style={{ width: `${windowMetrics.leftSpacerWidth}px` }}
          className="flex-shrink-0"
          aria-hidden="true"
        />
      )}

      {pooledPhotos.map(item => {
        const photo = item.photo;
        const rating = item.userRating;
        const isSelected = photo.id === selectedPhotoId;

        const isWebDemoUrl =
          !window.api &&
          (photo.file_path.startsWith('data:') || photo.file_path.startsWith('blob:'));
        const thumbFailed = failedThumbIds.has(photo.id);
        const resolvedById = getPhotoSrc(photo.thumbnail_path || photo.file_path, photo.id);
        const thumbSrc = resolvedById
          ? resolvedById
          : photo.thumbnail_path
            ? getPhotoSrc(thumbFailed ? photo.file_path : photo.thumbnail_path, photo.id)
            : photo.processing_status === 'completed'
              ? getPhotoSrc(photo.file_path, photo.id)
              : isWebDemoUrl
                ? photo.file_path
                : '';
        const hasValidThumb = Boolean(thumbSrc);

        return (
          <button
            key={photo.id}
            onClick={() => onSelectPhoto(item)}
            className={`relative h-14 w-14 rounded-lg overflow-hidden flex-shrink-0 border transition ${
              isSelected
                ? 'border-2 border-white ring-2 ring-white/80 scale-105'
                : 'border-[#2a2d3a] hover:border-gray-500 opacity-70 hover:opacity-100'
            }`}
          >
            {hasValidThumb ? (
              <img
                src={thumbSrc}
                alt={photo.file_name}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                onError={() => {
                  if (!thumbFailed) {
                    setFailedThumbIds(prev => {
                      const next = new Set(prev);
                      next.add(photo.id);
                      return next;
                    });
                  }
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[#1a1c23]">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400/60" />
              </div>
            )}

            {/* Badges */}
            <div className="absolute bottom-0.5 right-0.5 flex gap-0.5">
              {rating.pick_status === 'pick' && (
                <span
                  className="bg-emerald-600 text-white ring-1 ring-emerald-400 p-0.5 rounded-full"
                  title="Pick"
                >
                  <CheckCircle2 className="w-2.5 h-2.5" />
                </span>
              )}
              {rating.pick_status === 'reject' && (
                <span
                  className="bg-rose-600 text-white ring-1 ring-rose-400 p-0.5 rounded-full"
                  title="Reject"
                >
                  <XCircle className="w-2.5 h-2.5" />
                </span>
              )}
              {rating.star_rating > 0 && (
                <span className="bg-black/80 text-amber-400 px-1 rounded text-[9px] font-bold">
                  {rating.star_rating}★
                </span>
              )}
            </div>
          </button>
        );
      })}

      {windowMetrics.rightSpacerWidth > 0 && (
        <div
          style={{ width: `${windowMetrics.rightSpacerWidth}px` }}
          className="flex-shrink-0"
          aria-hidden="true"
        />
      )}
    </div>
  );
};
