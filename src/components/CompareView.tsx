import React, { useState } from 'react';
import { CombinedPhotoData, PickStatus } from '../types';
import { X, ZoomIn, ZoomOut, CheckCircle2, XCircle, Star, Sparkles, Trophy, Trash2 } from 'lucide-react';
import { getPhotoSrc } from '../utils/image';

interface CompareViewProps {
  candidates: CombinedPhotoData[];
  onRemoveCandidate: (photoId: string) => void;
  onUpdateRating: (photoId: string, pickStatus: PickStatus, starRating: number) => void;
  onSelectWinner: (photo: CombinedPhotoData) => void;
}

export const CompareView: React.FC<CompareViewProps> = ({
  candidates,
  onRemoveCandidate,
  onUpdateRating,
  onSelectWinner,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [focusedPhotoId, setFocusedPhotoId] = useState<string | null>(candidates[0]?.photo.id || null);

  if (candidates.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-gray-500 bg-[#0d0e11]">
        Select 2 or more photos in Grid View and press Compare (C) to launch Elimination Compare Mode.
      </div>
    );
  }

  const isSingleWinnerLeft = candidates.length === 1;
  const winner = candidates[0];

  const toggleZoom = () => {
    setZoomLevel(prev => (prev === 1 ? 2.2 : 1));
  };

  // Compute adaptive grid layout CSS
  const getGridColsClass = (count: number) => {
    if (count <= 2) return 'grid-cols-2';
    if (count <= 4) return 'grid-cols-2 grid-rows-2';
    if (count <= 6) return 'grid-cols-3 grid-rows-2';
    return 'grid-cols-4 grid-rows-2';
  };

  return (
    <div className="flex-1 flex flex-col bg-[#0d0e11] overflow-hidden relative">
      {/* Top Banner Control Bar */}
      <div className="h-12 bg-[#141519] border-b border-[#2a2d3a] px-4 flex items-center justify-between z-20 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-white uppercase tracking-wider">
            Multi-Image Elimination Mode ({candidates.length} Candidates Remaining)
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="text-gray-400 hidden sm:inline">
            Press <kbd className="bg-[#262933] px-1.5 py-0.5 rounded text-purple-300 font-mono">\</kbd> or <kbd className="bg-[#262933] px-1.5 py-0.5 rounded text-purple-300 font-mono">Del</kbd> to eliminate focused image
          </span>

          <button
            onClick={toggleZoom}
            className="flex items-center gap-1.5 bg-[#262933] hover:bg-purple-900/40 text-gray-200 px-3 py-1 rounded-md transition border border-gray-700/50"
          >
            {zoomLevel === 1 ? <ZoomIn className="w-3.5 h-3.5" /> : <ZoomOut className="w-3.5 h-3.5" />}
            <span>{zoomLevel === 1 ? 'Sync Zoom 100% (Z)' : 'Reset Zoom'}</span>
          </button>
        </div>
      </div>

      {/* Main Adaptive N-up Compare Grid */}
      <div className="flex-1 p-3 overflow-hidden">
        {isSingleWinnerLeft ? (
          /* Single Winner Mode Screen */
          <div className="h-full flex flex-col items-center justify-center bg-[#141519] rounded-2xl border border-amber-500/50 p-6 relative overflow-hidden shadow-2xl animate-fade-in">
            <div className="absolute top-4 left-4 flex items-center gap-2 bg-amber-500/20 text-amber-300 px-3 py-1 rounded-full border border-amber-500/40 text-xs font-semibold">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>Winner Selection</span>
            </div>

            <div className="flex-1 w-full max-h-[70%] flex items-center justify-center p-4">
              <img
                src={getPhotoSrc(winner.photo.file_path)}
                alt={winner.photo.file_name}
                className="max-h-full object-contain rounded-lg shadow-2xl border border-white/10"
              />
            </div>

            <div className="text-center space-y-3 mt-4">
              <h3 className="text-sm font-semibold text-white">{winner.photo.file_name}</h3>
              <p className="text-xs text-gray-400">All other comparison candidates have been eliminated.</p>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => {
                    onUpdateRating(winner.photo.id, 'pick', winner.userRating.star_rating || 4);
                    onSelectWinner(winner);
                  }}
                  className="px-5 py-2.5 bg-green-600 hover:bg-green-500 text-white font-medium text-xs rounded-xl shadow-lg flex items-center gap-2 transition"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Flag as Pick (P) & Confirm Winner</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* N-up Comparison Grid */
          <div className={`h-full grid ${getGridColsClass(candidates.length)} gap-3`}>
            {candidates.map((item, idx) => {
              const photo = item.photo;
              const rating = item.userRating;
              const ai = item.aiPrediction;
              const isFocused = photo.id === focusedPhotoId;

              return (
                <div
                  key={photo.id}
                  onClick={() => setFocusedPhotoId(photo.id)}
                  className={`group relative bg-[#141519] rounded-xl overflow-hidden border flex flex-col transition duration-150 ${
                    isFocused
                      ? 'border-purple-500 ring-2 ring-purple-500/50 shadow-2xl'
                      : 'border-[#2a2d3a] hover:border-gray-600'
                  }`}
                >
                  {/* Card Header Bar */}
                  <div className="h-8 bg-[#1a1c23] px-3 flex items-center justify-between text-xs border-b border-[#2a2d3a]">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="font-mono text-[10px] text-gray-500">#{idx + 1}</span>
                      <span className="truncate text-gray-300 font-medium">{photo.file_name}</span>
                    </div>

                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onRemoveCandidate(photo.id);
                      }}
                      title="Eliminate from comparison (\ or Del)"
                      className="p-1 text-gray-400 hover:text-red-400 hover:bg-red-950/40 rounded transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Synchronized Zoom Image Area */}
                  <div className="flex-1 relative overflow-hidden flex items-center justify-center p-2 bg-black/40">
                    <img
                      src={getPhotoSrc(photo.file_path || photo.thumbnail_path)}
                      alt={photo.file_name}
                      className="w-full h-full object-contain transition-transform duration-200"
                      onError={e => {
                        const target = e.currentTarget;
                        if (photo.thumbnail_path && target.src !== getPhotoSrc(photo.thumbnail_path)) {
                          target.src = getPhotoSrc(photo.thumbnail_path);
                        }
                      }}
                      style={{
                        transform: `scale(${zoomLevel})`,
                        transformOrigin: 'center center',
                      }}
                    />

                    {/* AI Preference Badge */}
                    {ai && (
                      <div className="absolute top-2 left-2 bg-purple-950/80 backdrop-blur-md px-2 py-0.5 rounded-full border border-purple-500/40 text-[10px] text-purple-200 font-medium flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-purple-300" />
                        <span>AI Suggests: {ai.predicted_rating} ★</span>
                      </div>
                    )}
                  </div>

                  {/* Card Bottom Quick Actions */}
                  <div className="h-10 bg-[#1a1c23] px-3 flex items-center justify-between border-t border-[#2a2d3a]">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onUpdateRating(photo.id, 'pick', rating.star_rating);
                        }}
                        className={`p-1.5 rounded transition ${
                          rating.pick_status === 'pick'
                            ? 'bg-green-600 text-white'
                            : 'bg-[#262933] text-gray-400 hover:text-green-400'
                        }`}
                        title="Pick Candidate (P)"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onUpdateRating(photo.id, 'reject', rating.star_rating);
                        }}
                        className={`p-1.5 rounded transition ${
                          rating.pick_status === 'reject'
                            ? 'bg-red-600 text-white'
                            : 'bg-[#262933] text-gray-400 hover:text-red-400'
                        }`}
                        title="Reject Candidate (X)"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onRemoveCandidate(photo.id);
                      }}
                      className="px-2.5 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-800/40 rounded text-[11px] font-medium flex items-center gap-1 transition"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Deselect (\)</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
