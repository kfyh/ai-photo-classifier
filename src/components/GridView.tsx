import React from 'react';
import { CombinedPhotoData, PickStatus } from '../types';
import { CheckCircle2, XCircle, Star, Sparkles, Image as ImageIcon } from 'lucide-react';
import { getPhotoSrc } from '../utils/image';

interface GridViewProps {
  photos: CombinedPhotoData[];
  selectedPhotoId: string | null;
  selectedPhotoIds: Set<string>;
  onSelectPhoto: (photo: CombinedPhotoData, isMultiSelect: boolean) => void;
  onUpdateRating: (photoId: string, pickStatus: PickStatus, starRating: number) => void;
  gridSize: number;
}

export const GridView: React.FC<GridViewProps> = ({
  photos,
  selectedPhotoId,
  selectedPhotoIds,
  onSelectPhoto,
  onUpdateRating,
  gridSize,
}) => {
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
    <div className="flex-1 overflow-y-auto p-4 bg-[#121316]">
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${gridSize}px, 1fr))`,
        }}
      >
        {photos.map(item => {
          const photo = item.photo;
          const rating = item.userRating;
          const ai = item.aiPrediction;
          const isPrimarySelected = photo.id === selectedPhotoId;
          const isMultiSelected = selectedPhotoIds.has(photo.id);

          return (
            <div
              key={photo.id}
              onClick={e => onSelectPhoto(item, e.ctrlKey || e.metaKey || e.shiftKey)}
              className={`group relative bg-[#1a1c23] rounded-xl overflow-hidden border transition duration-150 cursor-pointer ${
                isPrimarySelected
                  ? 'border-purple-500 ring-2 ring-purple-500/40 shadow-xl scale-[1.01]'
                  : isMultiSelected
                  ? 'border-purple-600/70 bg-purple-950/20'
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

              {/* Top Bar Overlay: AI Suggestion Badge */}
              {ai && (
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-purple-950/80 backdrop-blur-md text-purple-200 px-2 py-0.5 rounded-full border border-purple-500/40 text-[10px] font-medium shadow-md">
                  <Sparkles className="w-3 h-3 text-purple-300" />
                  <span>AI: {ai.predicted_rating} ★</span>
                </div>
              )}

              {/* Persistent & Hover Rating Bar Overlay */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2 flex flex-col justify-end gap-1.5 transition-all duration-150 z-10">
                <p className="text-[11px] font-medium text-white truncate drop-shadow-sm opacity-90 group-hover:opacity-100">
                  {photo.file_name}
                </p>

                <div className="flex items-center justify-between">
                  {/* Pick / Reject Flag Buttons */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onUpdateRating(photo.id, rating.pick_status === 'pick' ? 'unflagged' : 'pick', rating.star_rating);
                      }}
                      title="Set Pick Flag (P)"
                      className={`p-1 rounded-md transition shadow ${
                        rating.pick_status === 'pick'
                          ? 'bg-green-600 text-white font-bold ring-1 ring-white/20'
                          : 'bg-black/60 text-gray-400 hover:text-green-400 hover:bg-black/80'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onUpdateRating(photo.id, rating.pick_status === 'reject' ? 'unflagged' : 'reject', rating.star_rating);
                      }}
                      title="Set Reject Flag (X)"
                      className={`p-1 rounded-md transition shadow ${
                        rating.pick_status === 'reject'
                          ? 'bg-red-600 text-white font-bold ring-1 ring-white/20'
                          : 'bg-black/60 text-gray-400 hover:text-red-400 hover:bg-black/80'
                      }`}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* 5-Star Rating Buttons */}
                  <div className="flex items-center gap-0.5 bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded-md border border-white/10">
                    {[1, 2, 3, 4, 5].map(star => (
                      <button
                        key={star}
                        onClick={e => {
                          e.stopPropagation();
                          onUpdateRating(
                            photo.id,
                            rating.pick_status,
                            rating.star_rating === star ? 0 : star
                          );
                        }}
                        className="p-0.5 hover:scale-125 transition"
                        title={`Set ${star} Star`}
                      >
                        <Star
                          className={`w-3 h-3 ${
                            rating.star_rating >= star
                              ? 'text-amber-400 fill-amber-400'
                              : 'text-gray-500 hover:text-amber-300'
                          }`}
                        />
                      </button>
                    ))}
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
