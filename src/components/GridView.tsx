import React, { useState, useEffect, useMemo } from 'react';
import { CombinedPhotoData, PickStatus } from '../types';
import { CheckCircle2, XCircle, Sparkles, Image as ImageIcon } from 'lucide-react';
import { getPhotoSrc } from '../utils/image';
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
  // Progressive windowed rendering to prevent DOM freezing with thousands of photos
  const [renderLimit, setRenderLimit] = useState(120);

  useEffect(() => {
    setRenderLimit(120);
  }, [photos.length]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 800) {
      setRenderLimit(prev => Math.min(prev + 120, photos.length));
    }
  };

  const visiblePhotos = useMemo(() => {
    return photos.slice(0, renderLimit);
  }, [photos, renderLimit]);

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

  return (
    <div onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 bg-[#121316]">
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${gridSize}px, 1fr))`,
        }}
      >
        {visiblePhotos.map(item => {
          const photo = item.photo;
          const rating = item.userRating;
          const ai = item.aiPrediction;
          const isPrimarySelected = photo.id === selectedPhotoId;
          const isMultiSelected = selectedPhotoIds.has(photo.id);

          const showGhostedSuggestion = shouldShowAiSuggestion(rating, ai, confidenceThreshold);
          const showGhostStar = shouldShowGhostedStar(rating, ai, confidenceThreshold);
          const ghostPick = shouldShowGhostedPick(rating, ai, confidenceThreshold);

          return (
            <div
              key={photo.id}
              onClick={e => onSelectPhoto(item, e.ctrlKey || e.metaKey || e.shiftKey)}
              className={`group relative bg-[#1a1c23] rounded-xl overflow-hidden border transition duration-150 cursor-pointer select-none ${
                isPrimarySelected
                  ? 'border-amber-400 ring-2 ring-amber-400/50 shadow-xl scale-[1.01]'
                  : isMultiSelected
                    ? 'border-amber-500/70 bg-amber-950/20'
                    : 'border-[#2a2d3a] hover:border-gray-600 hover:shadow-md'
              }`}
              style={{ aspectRatio: '1 / 1' }}
            >
              {/* Thumbnail Image */}
              <img
                src={getPhotoSrc(photo.thumbnail_path || photo.file_path)}
                alt={photo.file_name}
                className="w-full h-full object-cover transition duration-200 group-hover:scale-[1.03]"
                loading="lazy"
                onError={e => {
                  const target = e.currentTarget;
                  if (photo.thumbnail_path && target.src !== getPhotoSrc(photo.file_path)) {
                    target.src = getPhotoSrc(photo.file_path);
                  }
                }}
              />

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
                  <div className="bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded-md border border-white/10">
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
  );
};
