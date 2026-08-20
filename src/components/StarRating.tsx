import React, { useState } from 'react';
import { Star } from 'lucide-react';

export interface StarRatingProps {
  rating: number; // Confirmed user rating (0 to 5) - Yellowish
  suggestedRating?: number | null; // AI suggested rating (0 to 5) - Bluish
  showSuggestion?: boolean; // Whether to render suggestion
  onRate: (newRating: number) => void;
  onAcceptSuggestion?: () => void; // Callback when accepting suggested rating
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

export const StarRating: React.FC<StarRatingProps> = ({
  rating,
  suggestedRating,
  showSuggestion = false,
  onRate,
  onAcceptSuggestion,
  size = 'md',
  disabled = false,
}) => {
  const [hoverRating, setHoverRating] = useState<number | null>(null);

  const starSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  const hasConfirmedRating = rating > 0;
  const hasValidSuggestion =
    !hasConfirmedRating &&
    showSuggestion &&
    suggestedRating !== undefined &&
    suggestedRating !== null &&
    suggestedRating > 0;

  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHoverRating(null)}>
      {[1, 2, 3, 4, 5].map(star => {
        const isHovered = hoverRating !== null && hoverRating >= star;
        const isUserRating = hoverRating === null && hasConfirmedRating && rating >= star;
        const isAiSuggestionUnconfirmed =
          hoverRating === null && hasValidSuggestion && suggestedRating >= star;

        let tooltip = `Set ${star} Star${star > 1 ? 's' : ''}`;
        if (hasValidSuggestion && suggestedRating) {
          tooltip = `AI Suggestion: ${suggestedRating} Star${suggestedRating > 1 ? 's' : ''} (Click or press Tab to accept)`;
        } else if (hasConfirmedRating) {
          tooltip = `${rating} Star${rating > 1 ? 's' : ''}`;
        }

        // Color coding:
        // - User selection/rating: Yellowish (amber-400)
        // - Hover preview: Yellowish (amber-300)
        // - AI Suggestion (unconfirmed): Bluish (sky-400, no pulse)
        // - Inactive: Gray
        let starClass = 'text-gray-600 hover:text-amber-300';
        if (hoverRating !== null) {
          starClass = isHovered ? 'text-amber-300 fill-amber-300' : 'text-gray-600';
        } else if (hasConfirmedRating) {
          starClass = isUserRating ? 'text-amber-400 fill-amber-400' : 'text-gray-600';
        } else if (isAiSuggestionUnconfirmed) {
          // Bluish color for AI suggestion - clean and static, no distracting pulse
          starClass = 'text-sky-400 fill-sky-400/40 drop-shadow-[0_0_3px_rgba(56,189,248,0.4)]';
        } else if (showSuggestion && suggestedRating && suggestedRating > 0) {
          starClass = 'text-gray-700';
        }

        return (
          <button
            key={star}
            type="button"
            disabled={disabled}
            onClick={e => {
              e.stopPropagation();
              if (isAiSuggestionUnconfirmed && onAcceptSuggestion && hoverRating === null) {
                onAcceptSuggestion();
              } else {
                onRate(rating === star ? 0 : star);
              }
            }}
            onMouseEnter={() => setHoverRating(star)}
            className="p-0.5 hover:scale-125 transition-transform duration-100 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            title={tooltip}
          >
            <Star className={`${starSizes[size]} transition-colors duration-100 ${starClass}`} />
          </button>
        );
      })}

      {/* Directly on the selector: AI Rating Badge indicator (only when photo has no stars set) */}
      {hasValidSuggestion && suggestedRating && (
        <span
          className="text-[9px] font-mono font-bold text-sky-300 bg-sky-950/80 px-1 py-0.5 rounded border border-sky-400/50 ml-0.5 select-none leading-none"
          title={`AI Suggested Rating: ${suggestedRating} Stars (Press Tab to Accept)`}
        >
          AI:{suggestedRating}★
        </span>
      )}
    </div>
  );
};
