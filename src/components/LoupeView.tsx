import React, { useState, useEffect } from 'react';
import { CombinedPhotoData, PickStatus } from '../types';
import {
  ZoomIn,
  ZoomOut,
  CheckCircle2,
  XCircle,
  Info,
  ChevronLeft,
  ChevronRight,
  Loader2,
  HelpCircle,
  Sparkles,
} from 'lucide-react';
import { getPhotoSrc } from '../utils/image';
import { StarRating } from './StarRating';
import {
  shouldShowAiSuggestion,
  shouldShowGhostedStar,
  shouldShowGhostedPick,
} from '../utils/ratingUtils';

interface LoupeViewProps {
  selectedPhoto: CombinedPhotoData | null;
  onUpdateRating: (photoId: string, pickStatus: PickStatus, starRating: number) => void;
  onAcceptAiSuggestion?: (photoId: string) => void;
  confidenceThreshold?: number;
  onNextPhoto: () => void;
  onPrevPhoto: () => void;
}

export const LoupeView: React.FC<LoupeViewProps> = ({
  selectedPhoto,
  onUpdateRating,
  onAcceptAiSuggestion,
  confidenceThreshold = 0.25,
  onNextPhoto,
  onPrevPhoto,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [showHud, setShowHud] = useState<boolean>(true);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);

  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
  }, [selectedPhoto?.photo.id]);

  if (!selectedPhoto) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-gray-500 bg-[#0d0e11]">
        Select a photo to open Loupe View
      </div>
    );
  }

  const photo = selectedPhoto.photo;
  const exif = selectedPhoto.exif;
  const rating = selectedPhoto.userRating;
  const ai = selectedPhoto.aiPrediction;

  const showGhostedSuggestion = shouldShowAiSuggestion(rating, ai, confidenceThreshold);
  const showGhostStar = shouldShowGhostedStar(rating, ai, confidenceThreshold);
  const ghostPick = shouldShowGhostedPick(rating, ai, confidenceThreshold);

  const toggleZoom = () => {
    setZoomLevel(prev => (prev === 1 ? 2.5 : 1));
  };

  const [currentSrc, setCurrentSrc] = useState<string>('');

  useEffect(() => {
    setCurrentSrc(getPhotoSrc(photo.thumbnail_path || photo.file_path));
  }, [photo.id, photo.thumbnail_path, photo.file_path]);

  return (
    <div className="flex-1 relative bg-[#0d0e11] flex items-center justify-center overflow-hidden group select-none">
      {/* Navigation Arrow Buttons */}
      <button
        onClick={onPrevPhoto}
        title="Previous Photo (Left Arrow)"
        className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black/60 hover:bg-amber-900/40 text-white rounded-full opacity-0 group-hover:opacity-100 transition duration-200 z-20 backdrop-blur-sm border border-white/10"
      >
        <ChevronLeft className="w-6 h-6" />
      </button>

      <button
        onClick={onNextPhoto}
        title="Next Photo (Right Arrow)"
        className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black/60 hover:bg-amber-900/40 text-white rounded-full opacity-0 group-hover:opacity-100 transition duration-200 z-20 backdrop-blur-sm border border-white/10"
      >
        <ChevronRight className="w-6 h-6" />
      </button>

      {/* Main Image Container with Loader / Error Fallback */}
      <div
        className="w-full h-full flex items-center justify-center cursor-zoom-in overflow-auto p-4 relative"
        onClick={toggleZoom}
      >
        {!isLoaded && !hasError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-2 z-10 bg-[#0d0e11]/80">
            <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
            <span className="text-xs">Loading preview...</span>
          </div>
        )}

        {hasError ? (
          <div className="flex flex-col items-center justify-center text-gray-500 gap-2 p-8 text-center border border-[#2a2d3a] rounded-2xl bg-[#141519]">
            <HelpCircle className="w-12 h-12 text-amber-400 opacity-60" />
            <span className="text-sm font-semibold text-gray-300">Preview Pending</span>
            <span className="text-xs text-gray-500">
              Image thumbnail is being prepared in the background...
            </span>
          </div>
        ) : (
          <img
            src={currentSrc || getPhotoSrc(photo.thumbnail_path || photo.file_path)}
            alt={photo.file_name}
            onLoad={() => setIsLoaded(true)}
            onError={() => {
              if (photo.file_path && currentSrc !== getPhotoSrc(photo.file_path)) {
                setCurrentSrc(getPhotoSrc(photo.file_path));
              } else if (photo.thumbnail_path && currentSrc !== getPhotoSrc(photo.thumbnail_path)) {
                setCurrentSrc(getPhotoSrc(photo.thumbnail_path));
              } else {
                setHasError(true);
              }
            }}
            className={`transition-transform duration-200 object-contain max-w-full max-h-full shadow-2xl select-none ${
              !isLoaded ? 'opacity-0' : 'opacity-100'
            }`}
            style={{
              transform: `scale(${zoomLevel})`,
              transformOrigin: 'center center',
            }}
          />
        )}
      </div>

      {/* Top Floating Controls Bar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-4 text-xs z-20 shadow-xl">
        <button
          onClick={toggleZoom}
          className="flex items-center gap-1.5 text-gray-300 hover:text-white transition"
        >
          {zoomLevel === 1 ? <ZoomIn className="w-4 h-4" /> : <ZoomOut className="w-4 h-4" />}
          <span>{zoomLevel === 1 ? 'Fit View' : '100% Zoom (Z)'}</span>
        </button>

        <span className="text-gray-600">|</span>

        <button
          onClick={() => setShowHud(prev => !prev)}
          className={`flex items-center gap-1.5 transition ${showHud ? 'text-amber-400 font-medium' : 'text-gray-400 hover:text-white'}`}
        >
          <Info className="w-4 h-4" />
          <span>HUD Info (I)</span>
        </button>
      </div>

      {/* EXIF Overlay HUD Box (Toggled via I key) */}
      {showHud && exif && (
        <div className="absolute bottom-20 left-6 bg-black/85 backdrop-blur-md p-3.5 rounded-xl border border-white/10 text-xs font-mono text-gray-200 z-20 space-y-1 shadow-2xl pointer-events-none">
          <p className="font-semibold text-white truncate max-w-[220px]">{photo.file_name}</p>
          <p className="text-gray-400">
            {exif.camera_make} {exif.camera_model}
          </p>
          <p className="text-amber-300">
            {exif.shutter_speed || '1/250s'} • {exif.aperture ? `f/${exif.aperture}` : 'f/2.8'} •{' '}
            {exif.iso ? `ISO ${exif.iso}` : 'ISO 100'}
          </p>
        </div>
      )}

      {/* Floating Bottom Quick Rating Bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/85 backdrop-blur-md px-5 py-2.5 rounded-full border border-white/15 flex items-center gap-4 z-20 shadow-2xl">
        {/* Inline Accept AI Pill Button (Bluish theme, no pulse) */}
        {showGhostedSuggestion && onAcceptAiSuggestion && (
          <button
            onClick={() => onAcceptAiSuggestion(photo.id)}
            title={`Accept AI Suggestion (${ai?.predicted_pick !== 'unflagged' ? ai?.predicted_pick : ''} ${ai?.predicted_rating ? `${ai.predicted_rating}★` : ''}) - Press Tab`}
            className="ai-accept-pill"
          >
            <Sparkles className="w-3.5 h-3.5 text-sky-300" />
            <span>Accept AI</span>
            <kbd className="kbd-badge">Tab</kbd>
          </button>
        )}

        {/* Pick & Reject Flags (Bright Green / Bright Red, Bluish AI Suggestions without pulse) */}
        <div className="flex gap-1.5 border-r border-white/10 pr-3">
          <button
            onClick={() => {
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
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow ${
              rating.pick_status === 'pick'
                ? 'bg-emerald-600 text-white ring-1 ring-emerald-400 font-bold shadow-lg'
                : ghostPick === 'pick'
                  ? 'border-2 border-dashed border-sky-400 text-sky-300 bg-sky-950/60 hover:bg-sky-900/70'
                  : 'bg-white/10 text-gray-300 hover:bg-emerald-950/40 hover:text-emerald-300'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Pick (P)</span>
          </button>

          <button
            onClick={() => {
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
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition shadow ${
              rating.pick_status === 'reject'
                ? 'bg-rose-600 text-white ring-1 ring-rose-400 font-bold shadow-lg'
                : ghostPick === 'reject'
                  ? 'border-2 border-dashed border-rose-400/80 text-rose-300 bg-rose-950/60 hover:bg-rose-900/70'
                  : 'bg-white/10 text-gray-300 hover:bg-rose-950/40 hover:text-rose-300'
            }`}
          >
            <XCircle className="w-4 h-4" />
            <span>Reject (X)</span>
          </button>
        </div>

        {/* Interactive Star Rating Controls with AI Rating on Selector */}
        <StarRating
          rating={rating.star_rating}
          suggestedRating={ai?.predicted_rating}
          showSuggestion={showGhostStar}
          onRate={newRating => onUpdateRating(photo.id, rating.pick_status, newRating)}
          onAcceptSuggestion={() => onAcceptAiSuggestion?.(photo.id)}
          size="lg"
        />
      </div>
    </div>
  );
};
