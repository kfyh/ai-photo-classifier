import React from 'react';
import { CombinedPhotoData, PickStatus } from '../types';
import { HistogramWidget } from './HistogramWidget';
import {
  ChevronRight,
  ChevronLeft,
  Camera,
  Sliders,
  Star,
  XCircle,
  CheckCircle2,
  Sparkles,
  ExternalLink,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { StarRating } from './StarRating';
import {
  getThresholdMultiplier,
  PICK_RANDOM_BASELINE,
  RATING_RANDOM_BASELINE,
  shouldShowGhostedStar,
} from '../utils/ratingUtils';

interface RightSidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  selectedPhoto: CombinedPhotoData | null;
  onUpdateRating: (photoId: string, pickStatus: PickStatus, starRating: number) => void;
  onExportRawTherapee: (photoPath: string, rating: number, pickStatus: PickStatus) => void;
  confidenceThreshold?: number;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  isCollapsed,
  onToggleCollapse,
  selectedPhoto,
  onUpdateRating,
  onExportRawTherapee,
  confidenceThreshold = 1.5,
}) => {
  if (isCollapsed) {
    return (
      <div className="w-12 bg-[#1a1c23] border-l border-[#2a2d3a] flex flex-col items-center py-3 gap-4 z-20">
        <button
          onClick={onToggleCollapse}
          title="Expand Right Metadata Sidebar (Shift+Tab)"
          className="p-2 text-gray-400 hover:text-white hover:bg-[#262933] rounded-lg transition"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <Sliders className="w-5 h-5 text-gray-500" />
      </div>
    );
  }

  const photo = selectedPhoto?.photo;
  const exif = selectedPhoto?.exif;
  const rating = selectedPhoto?.userRating;
  const quality = selectedPhoto?.quality;
  const ai = selectedPhoto?.aiPrediction;

  const showGhostStar = shouldShowGhostedStar(rating, ai, confidenceThreshold);
  const thresholdMultiplier = getThresholdMultiplier(confidenceThreshold);
  const isLowConfidence =
    ai &&
    ((ai.rating_confidence ?? 0) < thresholdMultiplier * RATING_RANDOM_BASELINE ||
      (ai.pick_confidence ?? 0) < thresholdMultiplier * PICK_RANDOM_BASELINE);

  // Delta calculation against confirmed user rating
  let deltaRatingText: string | null = null;
  let deltaPickText: string | null = null;
  let isFullyAgreed = false;

  if (ai && rating && rating.is_confirmed) {
    const starDiff = rating.star_rating - ai.predicted_rating;
    if (starDiff === 0) {
      deltaRatingText = 'Stars: Match (0)';
    } else {
      deltaRatingText = `Stars: ${starDiff > 0 ? `+${starDiff}` : starDiff}★`;
    }

    if (rating.pick_status === ai.predicted_pick) {
      deltaPickText = 'Flag: Match';
    } else {
      deltaPickText = `Flag: ${ai.predicted_pick} → ${rating.pick_status}`;
    }

    isFullyAgreed = starDiff === 0 && rating.pick_status === ai.predicted_pick;
  }

  return (
    <aside className="w-72 bg-[#1a1c23] border-l border-[#2a2d3a] flex flex-col h-full z-20 flex-shrink-0 select-none">
      {/* Header with collapse toggle */}
      <div className="p-3 border-b border-[#2a2d3a] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold tracking-wider text-gray-300 uppercase">
            Metadata & AI
          </span>
        </div>
        <button
          onClick={onToggleCollapse}
          title="Collapse Sidebar (Shift+Tab)"
          className="p-1 text-gray-400 hover:text-white hover:bg-[#262933] rounded transition"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* RGB Histogram Widget */}
        <HistogramWidget imagePath={photo ? photo.file_path : null} />

        {/* Selected Photo Summary & Quick Rating */}
        {selectedPhoto ? (
          <>
            <div className="bg-[#141519] p-3 rounded-lg border border-[#2a2d3a] space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4
                    className="text-xs font-medium text-white truncate max-w-[170px]"
                    title={photo?.file_name}
                  >
                    {photo?.file_name}
                  </h4>
                  <p className="text-[10px] font-mono text-gray-500">
                    {photo
                      ? `${photo.width} × ${photo.height} • ${(photo.file_size / (1024 * 1024)).toFixed(1)} MB`
                      : ''}
                  </p>
                </div>
                <button
                  onClick={() =>
                    photo &&
                    rating &&
                    onExportRawTherapee(photo.file_path, rating.star_rating, rating.pick_status)
                  }
                  title="Export Rating to RawTherapee .pp3 & XMP Sidecars"
                  className="p-1.5 bg-[#262933] hover:bg-amber-900/40 hover:text-amber-300 text-gray-400 rounded transition border border-gray-700/40 flex items-center gap-1 text-[10px]"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>PP3</span>
                </button>
              </div>

              {/* User Rating Controls with Green Pick / Red Reject */}
              <div className="pt-2 border-t border-[#222530] space-y-2">
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span>Pick Status:</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() =>
                        photo &&
                        onUpdateRating(
                          photo.id,
                          rating?.pick_status === 'pick' ? 'none' : 'pick',
                          rating?.star_rating || 0
                        )
                      }
                      className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition ${
                        rating?.pick_status === 'pick'
                          ? 'bg-emerald-600 text-white ring-1 ring-emerald-400 font-bold shadow-sm'
                          : 'bg-[#262933] text-gray-400 hover:text-emerald-400'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Pick (P)</span>
                    </button>
                    <button
                      onClick={() =>
                        photo &&
                        onUpdateRating(
                          photo.id,
                          rating?.pick_status === 'reject' ? 'none' : 'reject',
                          rating?.star_rating || 0
                        )
                      }
                      className={`px-2.5 py-1 rounded text-xs flex items-center gap-1.5 transition ${
                        rating?.pick_status === 'reject'
                          ? 'bg-rose-600 text-white ring-1 ring-rose-400 font-bold shadow-sm'
                          : 'bg-[#262933] text-gray-400 hover:text-rose-400'
                      }`}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject (X)</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-gray-400 pt-1">
                  <span>Star Rating:</span>
                  <StarRating
                    rating={rating?.star_rating || 0}
                    suggestedRating={ai?.predicted_rating}
                    showSuggestion={showGhostStar}
                    onRate={newRating =>
                      photo &&
                      onUpdateRating(photo.id, rating?.pick_status || 'unflagged', newRating)
                    }
                    size="md"
                  />
                </div>
              </div>
            </div>

            {/* AI Prediction Breakdown (Bluish Theme) */}
            {ai && (
              <div className="bg-[#0c2340] p-3 rounded-lg border border-sky-500/40 space-y-2.5 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-sky-200">
                    <Sparkles className="w-4 h-4 text-sky-300" />
                    <span>AI Prediction Analysis</span>
                  </div>
                  {isLowConfidence && (
                    <span className="text-[9px] font-mono font-bold text-amber-300 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-500/50 flex items-center gap-1">
                      <AlertCircle className="w-2.5 h-2.5" />
                      <span>Below Target (&lt;{thresholdMultiplier.toFixed(1)}× chance)</span>
                    </span>
                  )}
                </div>

                {/* Suggestions Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs pt-0.5">
                  <div className="bg-[#071322] p-2 rounded border border-sky-900/60 space-y-1">
                    <span className="text-[10px] text-gray-400 block">Suggested Flag</span>
                    <span
                      className={`font-bold capitalize text-xs ${
                        ai.predicted_pick === 'pick'
                          ? 'text-sky-300'
                          : ai.predicted_pick === 'reject'
                            ? 'text-rose-300'
                            : 'text-gray-400'
                      }`}
                    >
                      {ai.predicted_pick}
                    </span>
                    <div className="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden mt-1">
                      <div
                        className={`h-full ${
                          ai.pick_confidence >= 0.7
                            ? 'bg-emerald-400'
                            : ai.pick_confidence >= 0.45
                              ? 'bg-amber-400'
                              : 'bg-rose-400'
                        }`}
                        style={{ width: `${Math.round(ai.pick_confidence * 100)}%` }}
                      />
                    </div>
                    <span className="text-[9px] font-mono text-gray-400 block pt-0.5">
                      {Math.round(ai.pick_confidence * 100)}% (
                      {(ai.pick_confidence / 0.3333).toFixed(1)}× chance)
                    </span>
                  </div>

                  <div className="bg-[#071322] p-2 rounded border border-sky-900/60 space-y-1">
                    <span className="text-[10px] text-gray-400 block">Suggested Rating</span>
                    <span className="font-bold text-sky-300 flex items-center gap-1 text-xs">
                      {ai.predicted_rating}{' '}
                      <Star className="w-3.5 h-3.5 fill-sky-400 text-sky-400" />
                    </span>
                    <div className="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden mt-1">
                      <div
                        className={`h-full ${
                          ai.rating_confidence >= 0.35
                            ? 'bg-emerald-400'
                            : ai.rating_confidence >= 0.25
                              ? 'bg-amber-400'
                              : 'bg-rose-400'
                        }`}
                        style={{
                          width: `${Math.min(100, Math.round(ai.rating_confidence * 200))}%`,
                        }}
                      />
                    </div>
                    <span className="text-[9px] font-mono text-gray-400 block pt-0.5">
                      {Math.round(ai.rating_confidence * 100)}% (
                      {(ai.rating_confidence / 0.1667).toFixed(1)}× chance)
                    </span>
                  </div>
                </div>

                {/* Agreement Delta Bar (Displays when rating is confirmed) */}
                {rating?.is_confirmed && (
                  <div className="pt-2 border-t border-sky-900/60 flex items-center justify-between text-[10px] font-mono text-gray-300">
                    <span className="text-gray-400">User vs AI Delta:</span>
                    {isFullyAgreed ? (
                      <span className="text-emerald-300 font-semibold flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-emerald-400" />
                        <span>Full Agreement</span>
                      </span>
                    ) : (
                      <span className="text-amber-300 font-semibold">
                        {deltaRatingText} • {deltaPickText}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Background Metadata Processing State Banner */}
            {(!ai || photo?.processing_status === 'pending') && (
              <div className="bg-[#0c2340]/70 p-3 rounded-lg border border-sky-500/30 flex items-center gap-2.5 text-xs text-sky-300">
                <Sparkles className="w-4 h-4 text-sky-400 flex-shrink-0" />
                <div>
                  <span className="font-semibold block text-sky-200">Processing Metadata</span>
                  <span className="text-[10px] text-sky-300/80">
                    Extracting EXIF, histogram & AI predictions in background...
                  </span>
                </div>
              </div>
            )}

            {/* EXIF Details */}
            <div className="bg-[#141519] p-3 rounded-lg border border-[#2a2d3a] space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300 border-b border-[#222530] pb-2">
                <Camera className="w-3.5 h-3.5 text-gray-400" />
                <span>Camera EXIF Data</span>
              </div>

              <div className="text-[11px] space-y-2 font-mono text-gray-300">
                <div className="flex justify-between">
                  <span className="text-gray-500">Camera:</span>
                  <span className="truncate max-w-[150px]">
                    {exif?.camera_make} {exif?.camera_model}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Lens:</span>
                  <span className="truncate max-w-[150px]">{exif?.lens_model || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">ISO:</span>
                  <span>{exif?.iso ? `ISO ${exif.iso}` : 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Aperture:</span>
                  <span>{exif?.aperture ? `f/${exif.aperture}` : 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Shutter:</span>
                  <span>{exif?.shutter_speed || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Focal Length:</span>
                  <span>{exif?.focal_length ? `${exif.focal_length}mm` : 'N/A'}</span>
                </div>
                {quality && (
                  <div className="flex justify-between pt-1 border-t border-[#222530]">
                    <span className="text-gray-500">Blur Var Score:</span>
                    <span className={quality.blur_score < 50 ? 'text-red-400' : 'text-green-400'}>
                      {quality.blur_score}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="p-6 text-center text-xs text-gray-500 space-y-2">
            <Camera className="w-8 h-8 mx-auto text-gray-600 opacity-60" />
            <p>Select a photo in the grid to view EXIF metadata & AI prediction analysis.</p>
          </div>
        )}
      </div>
    </aside>
  );
};
