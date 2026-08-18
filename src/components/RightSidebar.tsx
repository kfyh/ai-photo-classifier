import React from 'react';
import { CombinedPhotoData, PickStatus } from '../types';
import { HistogramWidget } from './HistogramWidget';
import { ChevronRight, ChevronLeft, Camera, Sliders, Star, Flag, XCircle, CheckCircle2, Sparkles, ExternalLink } from 'lucide-react';
import { StarRating } from './StarRating';

interface RightSidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  selectedPhoto: CombinedPhotoData | null;
  onUpdateRating: (photoId: string, pickStatus: PickStatus, starRating: number) => void;
  onExportRawTherapee: (photoPath: string, rating: number, pickStatus: PickStatus) => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  isCollapsed,
  onToggleCollapse,
  selectedPhoto,
  onUpdateRating,
  onExportRawTherapee,
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

  return (
    <aside className="w-72 bg-[#1a1c23] border-l border-[#2a2d3a] flex flex-col h-full z-20 flex-shrink-0">
      {/* Header with collapse toggle */}
      <div className="p-3 border-b border-[#2a2d3a] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-purple-400" />
          <span className="text-xs font-semibold tracking-wider text-gray-300 uppercase">Metadata & AI</span>
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
                  <h4 className="text-xs font-medium text-white truncate max-w-[170px]" title={photo?.file_name}>
                    {photo?.file_name}
                  </h4>
                  <p className="text-[10px] font-mono text-gray-500">
                    {photo ? `${photo.width} × ${photo.height} • ${(photo.file_size / (1024 * 1024)).toFixed(1)} MB` : ''}
                  </p>
                </div>
                <button
                  onClick={() => photo && rating && onExportRawTherapee(photo.file_path, rating.star_rating, rating.pick_status)}
                  title="Export Rating to RawTherapee .pp3 & XMP Sidecars"
                  className="p-1.5 bg-[#262933] hover:bg-purple-900/50 hover:text-purple-300 text-gray-400 rounded transition border border-gray-700/40 flex items-center gap-1 text-[10px]"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>PP3</span>
                </button>
              </div>

              {/* Rating Controls */}
              <div className="pt-2 border-t border-[#222530] space-y-2">
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span>Pick Status:</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => photo && onUpdateRating(photo.id, rating?.pick_status === 'pick' ? 'unflagged' : 'pick', rating?.star_rating || 0)}
                      className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition ${
                        rating?.pick_status === 'pick'
                          ? 'bg-green-600 text-white font-medium shadow-sm'
                          : 'bg-[#262933] text-gray-400 hover:text-green-400'
                      }`}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Pick (P)</span>
                    </button>
                    <button
                      onClick={() => photo && onUpdateRating(photo.id, rating?.pick_status === 'reject' ? 'unflagged' : 'reject', rating?.star_rating || 0)}
                      className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition ${
                        rating?.pick_status === 'reject'
                          ? 'bg-red-600 text-white font-medium shadow-sm'
                          : 'bg-[#262933] text-gray-400 hover:text-red-400'
                      }`}
                    >
                      <XCircle className="w-3 h-3" />
                      <span>Reject (X)</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-gray-400 pt-1">
                  <span>Star Rating:</span>
                  <StarRating
                    rating={rating?.star_rating || 0}
                    onRate={newRating => photo && onUpdateRating(photo.id, rating?.pick_status || 'unflagged', newRating)}
                    size="md"
                  />
                </div>
              </div>
            </div>

            {/* AI Prediction Breakdown */}
            {ai && (
              <div className="bg-purple-950/20 p-3 rounded-lg border border-purple-800/30 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-300">
                    <Sparkles className="w-4 h-4 text-purple-400 animate-pulse" />
                    <span>AI Prediction</span>
                  </div>
                  <span className="text-[10px] font-mono text-purple-400 bg-purple-900/50 px-1.5 py-0.5 rounded border border-purple-700/40">
                    {Math.round(ai.rating_confidence * 100)}% Conf
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                  <div className="bg-[#141519] p-2 rounded border border-[#2a2d3a]">
                    <span className="text-[10px] text-gray-500 block">Suggested Pick</span>
                    <span className={`font-semibold capitalize ${
                      ai.predicted_pick === 'pick' ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {ai.predicted_pick}
                    </span>
                  </div>
                  <div className="bg-[#141519] p-2 rounded border border-[#2a2d3a]">
                    <span className="text-[10px] text-gray-500 block">Suggested Rating</span>
                    <span className="font-semibold text-amber-400 flex items-center gap-1">
                      {ai.predicted_rating} <Star className="w-3 h-3 fill-amber-400" />
                    </span>
                  </div>
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
                  <span className="truncate max-w-[150px]">{exif?.camera_make} {exif?.camera_model}</span>
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
