import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CombinedPhotoData, PickStatus } from '../types';
import { CheckCircle2, XCircle, Sparkles, Image as ImageIcon, Loader2 } from 'lucide-react';
import {
  getPhotoSrc,
  getSizedPhotoSrc,
  invalidateCachedThumb,
  useResolvedThumbnails,
} from '../utils/image';
import { StarRating } from './StarRating';
import {
  shouldShowAiSuggestion,
  shouldShowGhostedStar,
  shouldShowGhostedPick,
} from '../utils/ratingUtils';

interface GridViewProps {
  photos: CombinedPhotoData[];
  selectedPhotoId: string | null;
  selectedPhotoIds: Set<string>;
  onSelectPhoto: (photo: CombinedPhotoData, isMultiSelect: boolean) => void;
  onUpdateRating: (photoId: string, pickStatus: PickStatus, starRating: number) => void;
  onAcceptAiSuggestion?: (photoId: string) => void;
  confidenceThreshold?: number;
  gridSize: number;
}

const GRID_PADDING_PX = 16; // p-4 = 16px on each side
const GRID_GAP_PX = 12; // gap-3 = 12px
const OVERSCAN_ROWS = 4;
const PREFETCH_EXTRA_ROWS = 3;

export const GridView: React.FC<GridViewProps> = ({
  photos,
  selectedPhotoId,
  selectedPhotoIds,
  onSelectPhoto,
  onUpdateRating,
  onAcceptAiSuggestion,
  confidenceThreshold = 0.25,
  gridSize,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRafRef = useRef<number | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 800 });
  const [failedThumbIds, setFailedThumbIds] = useState<Set<string>>(new Set());
  const requestedPriorityIdsRef = useRef<Set<string>>(new Set());
  const lastMouseSelectedIdRef = useRef<string | null>(null);

  // Measure container dimensions via ResizeObserver for accurate 2D slot pooling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateDimensions = () => {
      setViewportSize({
        width: el.clientWidth || 1200,
        height: el.clientHeight || 800,
      });
    };

    updateDimensions();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateDimensions);
      observer.observe(el);
      return () => observer.disconnect();
    } else {
      window.addEventListener('resize', updateDimensions);
      return () => window.removeEventListener('resize', updateDimensions);
    }
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const nextTop = e.currentTarget.scrollTop;
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      setScrollTop(nextTop);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  // Compute 2D virtualized grid geometry and fixed slot pool window
  const gridMetrics = useMemo(() => {
    const innerWidth = Math.max(gridSize, viewportSize.width - GRID_PADDING_PX * 2);
    const columns = Math.max(
      1,
      Math.floor((innerWidth + GRID_GAP_PX) / (gridSize + GRID_GAP_PX))
    );
    const cellSize = (innerWidth - (columns - 1) * GRID_GAP_PX) / columns;
    const rowStride = Math.max(80, cellSize + GRID_GAP_PX);
    const totalRows = Math.ceil(photos.length / columns);

    const visibleStartRow = Math.max(0, Math.floor(scrollTop / rowStride));
    const visibleEndRow = Math.min(
      totalRows,
      Math.ceil((scrollTop + viewportSize.height) / rowStride)
    );

    const startRow = Math.max(0, visibleStartRow - OVERSCAN_ROWS);
    const endRow = Math.min(totalRows, visibleEndRow + OVERSCAN_ROWS);

    const startIndex = startRow * columns;
    const endIndex = Math.min(photos.length, endRow * columns);

    const topSpacerHeight = startRow * rowStride;
    const bottomSpacerHeight = Math.max(0, (totalRows - endRow) * rowStride);

    // Visible page + 1 lookahead row for high-priority thumbnail generation
    const priorityStartIndex = visibleStartRow * columns;
    const priorityEndIndex = Math.min(photos.length, (visibleEndRow + 1) * columns);

    return {
      columns,
      cellSize,
      rowStride,
      totalRows,
      visibleStartRow,
      visibleEndRow,
      startIndex,
      endIndex,
      topSpacerHeight,
      bottomSpacerHeight,
      priorityStartIndex,
      priorityEndIndex,
    };
  }, [photos.length, viewportSize.width, viewportSize.height, gridSize, scrollTop]);

  // Pooled slice of photos mounted in the DOM (visible + overscan buffer)
  const pooledPhotos = useMemo(() => {
    return photos.slice(gridMetrics.startIndex, gridMetrics.endIndex);
  }, [photos, gridMetrics.startIndex, gridMetrics.endIndex]);

  // Visible rows first, then off-screen buffer below, then off-screen buffer above
  const prefetchPhotos = useMemo(() => {
    const { columns, totalRows, visibleStartRow, visibleEndRow } = gridMetrics;
    const visStart = visibleStartRow * columns;
    const visEnd = Math.min(photos.length, visibleEndRow * columns);
    const belowEnd = Math.min(
      photos.length,
      Math.min(totalRows, visibleEndRow + OVERSCAN_ROWS + PREFETCH_EXTRA_ROWS) * columns
    );
    const aboveStart = Math.max(0, visibleStartRow - OVERSCAN_ROWS - PREFETCH_EXTRA_ROWS) * columns;
    return [
      ...photos.slice(visStart, visEnd),
      ...photos.slice(visEnd, belowEnd),
      ...photos.slice(aboveStart, visStart),
    ];
  }, [photos, gridMetrics]);

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const slotPx = Math.min(
    2048,
    Math.max(128, Math.ceil((gridMetrics.cellSize * dpr) / 64) * 64)
  );

  useResolvedThumbnails(prefetchPhotos, slotPx);

  // Keep selected photo scrolled into view when navigating via keyboard
  useEffect(() => {
    if (!selectedPhotoId || !containerRef.current || photos.length === 0) return;
    if (lastMouseSelectedIdRef.current === selectedPhotoId) {
      lastMouseSelectedIdRef.current = null;
      return;
    }
    const idx = photos.findIndex(p => p.photo.id === selectedPhotoId);
    if (idx < 0) return;

    const targetRow = Math.floor(idx / gridMetrics.columns);
    const rowTop = GRID_PADDING_PX + targetRow * gridMetrics.rowStride;
    const rowBottom = rowTop + gridMetrics.rowStride - GRID_GAP_PX;
    const el = containerRef.current;

    if (rowTop < el.scrollTop) {
      el.scrollTo({ top: Math.max(0, rowTop - GRID_PADDING_PX), behavior: 'auto' });
    } else if (rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTo({
        top: rowBottom - el.clientHeight + GRID_PADDING_PX,
        behavior: 'auto',
      });
    }
  }, [selectedPhotoId, gridMetrics.columns, gridMetrics.rowStride]);

  // Clear failed thumbnail state when a photo receives a new thumbnail_path
  useEffect(() => {
    setFailedThumbIds(prev => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set(prev);
      for (const item of pooledPhotos) {
        if (item.photo.thumbnail_path && next.has(item.photo.id)) {
          next.delete(item.photo.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [pooledPhotos]);

  // Viewport-first thumbnail prioritization: request visible page thumbnails ahead of off-screen queue
  useEffect(() => {
    if (!window.api?.prioritizeThumbnails || photos.length === 0) return;

    const visibleSlice = photos.slice(
      gridMetrics.priorityStartIndex,
      gridMetrics.priorityEndIndex
    );
    const missingIds = visibleSlice
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
  }, [photos, gridMetrics.priorityStartIndex, gridMetrics.priorityEndIndex]);

  if (photos.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#121316]">
        <div className="w-16 h-16 bg-[#1a1c23] rounded-2xl flex items-center justify-center mb-4 border border-[#2a2d3a]">
          <ImageIcon className="w-8 h-8 text-purple-400 opacity-80" />
        </div>
        <h3 className="text-sm font-semibold text-gray-300">No Photos Found</h3>
        <p className="text-xs text-gray-500 max-w-sm mt-1">
          Open a shoot folder from the left sidebar or clear your search filters to display photos.
        </p>
      </div>
    );
  }

  const totalContentHeight =
    gridMetrics.totalRows > 0
      ? Math.max(0, gridMetrics.totalRows * gridMetrics.rowStride - GRID_GAP_PX)
      : 0;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto p-4 bg-[#121316]"
      style={{ overflowAnchor: 'none' }}
    >
      {/* Fixed-height scroll canvas prevents scrollHeight jumps and browser scroll anchoring */}
      <div style={{ height: `${totalContentHeight}px`, position: 'relative' }}>
        {/* Fixed-capacity DOM slot pool positioned via GPU transform */}
        <div
          className="grid gap-3"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            transform: `translateY(${gridMetrics.topSpacerHeight}px)`,
            gridTemplateColumns: `repeat(${gridMetrics.columns}, minmax(0, 1fr))`,
          }}
        >
          {pooledPhotos.map(item => {
            const photo = item.photo;
            const rating = item.userRating;
            const ai = item.aiPrediction;
            const isPrimarySelected = photo.id === selectedPhotoId;
            const isMultiSelected = selectedPhotoIds.has(photo.id);

            const showGhostedSuggestion = shouldShowAiSuggestion(rating, ai, confidenceThreshold);
            const showGhostStar = shouldShowGhostedStar(rating, ai, confidenceThreshold);
            const ghostPick = shouldShowGhostedPick(rating, ai, confidenceThreshold);

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
            const sizedThumbSrc = getSizedPhotoSrc(photo.id, slotPx);
            const hasValidThumb = Boolean(thumbSrc || sizedThumbSrc) && !thumbFailed;

            return (
              <div
                key={photo.id}
                onClick={e => {
                  lastMouseSelectedIdRef.current = photo.id;
                  onSelectPhoto(item, e.ctrlKey || e.metaKey || e.shiftKey);
                }}
                className={`group relative bg-[#1a1c23] rounded-xl overflow-hidden border transition duration-150 cursor-pointer select-none ${
                  isPrimarySelected
                    ? 'border-2 border-white ring-2 ring-white/80 shadow-xl scale-[1.01]'
                    : isMultiSelected
                      ? 'border-2 border-white/70 ring-1 ring-white/40 bg-white/10'
                      : 'border-[#2a2d3a] hover:border-gray-600 hover:shadow-md'
                }`}
                style={{ aspectRatio: '1 / 1' }}
              >
                {/* Cached Thumbnail or Lightweight Skeleton Placeholder */}
                {hasValidThumb ? (
                  <>
                    {thumbSrc && (
                      <img
                        src={thumbSrc}
                        alt={photo.file_name}
                        className="w-full h-full object-cover transition duration-200 group-hover:scale-[1.03]"
                        onError={() => {
                          invalidateCachedThumb(photo.id, photo.file_path);
                          if (!thumbFailed) {
                            setFailedThumbIds(prev => {
                              const next = new Set(prev);
                              next.add(photo.id);
                              return next;
                            });
                          }
                        }}
                      />
                    )}
                    {sizedThumbSrc && (
                      <img
                        src={sizedThumbSrc}
                        alt={photo.file_name}
                        className="absolute inset-0 w-full h-full object-cover transition duration-200 group-hover:scale-[1.03]"
                      />
                    )}
                  </>
                ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[#141519] text-gray-500 gap-2 p-3">
                  <Loader2 className="w-5 h-5 animate-spin text-amber-400/70" />
                  <span className="text-[10px] text-gray-500 font-mono truncate max-w-full">
                    Generating thumbnail...
                  </span>
                </div>
              )}

              {/* Inline Accept AI Suggestion Action Pill (Visible on hover if suggestion exists and photo unrated) */}
              {showGhostedSuggestion && onAcceptAiSuggestion && (
                <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20">
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onAcceptAiSuggestion(photo.id);
                    }}
                    title={`Accept AI Suggestion (${ai?.predicted_pick !== 'unflagged' && ai?.predicted_pick !== 'none' ? ai?.predicted_pick : ''} ${ai?.predicted_rating ? `${ai.predicted_rating}★` : ''}) - Press Tab`}
                    className="ai-accept-pill"
                  >
                    <Sparkles className="w-3 h-3 text-sky-300" />
                    <span>Accept AI</span>
                    <kbd className="kbd-badge">Tab</kbd>
                  </button>
                </div>
              )}

              {/* Persistent & Hover Rating Bar Overlay */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-2 flex flex-col justify-end gap-1.5 transition-all duration-150 z-10">
                <p className="text-[11px] font-medium text-white truncate drop-shadow-sm opacity-90 group-hover:opacity-100">
                  {photo.file_name}
                </p>

                <div className="flex items-center justify-between">
                  {/* Pick / Reject Flag Buttons (Bright Green / Bright Red, Bluish for AI Suggestion) */}
                  <div className="flex items-center gap-1">
                    {/* Pick Flag Button: Bright Green when confirmed, Bluish for AI suggestion (No pulsing) */}
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        if (
                          ghostPick === 'pick' &&
                          (rating.pick_status === 'unflagged' || rating.pick_status === 'none') &&
                          onAcceptAiSuggestion
                        ) {
                          onAcceptAiSuggestion(photo.id);
                        } else {
                          onUpdateRating(
                            photo.id,
                            rating.pick_status === 'pick' ? 'none' : 'pick',
                            rating.star_rating
                          );
                        }
                      }}
                      title={
                        rating.pick_status === 'pick'
                          ? 'Pick Confirmed (P)'
                          : ghostPick === 'pick'
                            ? 'AI Suggestion: Pick (Click or Press Tab to Accept)'
                            : 'Set Pick Flag (P)'
                      }
                      className={`p-1 rounded-md transition shadow flex items-center justify-center ${
                        rating.pick_status === 'pick'
                          ? 'bg-emerald-600 text-white ring-1 ring-emerald-400 font-bold'
                          : ghostPick === 'pick'
                            ? 'border-2 border-dashed border-sky-400 text-sky-300 bg-sky-950/50 hover:bg-sky-900/60'
                            : 'bg-black/60 text-gray-400 hover:text-emerald-400 hover:bg-black/80'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </button>

                    {/* Reject Flag Button: Bright Red when confirmed (No pulsing) */}
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        if (
                          ghostPick === 'reject' &&
                          (rating.pick_status === 'unflagged' || rating.pick_status === 'none') &&
                          onAcceptAiSuggestion
                        ) {
                          onAcceptAiSuggestion(photo.id);
                        } else {
                          onUpdateRating(
                            photo.id,
                            rating.pick_status === 'reject' ? 'none' : 'reject',
                            rating.star_rating
                          );
                        }
                      }}
                      title={
                        rating.pick_status === 'reject'
                          ? 'Reject Confirmed (X)'
                          : ghostPick === 'reject'
                            ? 'AI Suggestion: Reject (Click or Press Tab to Accept)'
                            : 'Set Reject Flag (X)'
                      }
                      className={`p-1 rounded-md transition shadow flex items-center justify-center ${
                        rating.pick_status === 'reject'
                          ? 'bg-rose-600 text-white ring-1 ring-rose-400 font-bold'
                          : ghostPick === 'reject'
                            ? 'border-2 border-dashed border-rose-400/80 text-rose-300 bg-rose-950/50 hover:bg-rose-900/60'
                            : 'bg-black/60 text-gray-400 hover:text-rose-400 hover:bg-black/80'
                      }`}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Interactive 5-Star Rating Control with AI Rating exclusively on the selector */}
                  <div className="bg-black/75 px-1.5 py-0.5 rounded-md border border-white/10">
                    <StarRating
                      rating={rating.star_rating}
                      suggestedRating={ai?.predicted_rating}
                      showSuggestion={showGhostStar}
                      onRate={newRating => onUpdateRating(photo.id, rating.pick_status, newRating)}
                      onAcceptSuggestion={() => onAcceptAiSuggestion?.(photo.id)}
                      size="sm"
                    />
                  </div>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
