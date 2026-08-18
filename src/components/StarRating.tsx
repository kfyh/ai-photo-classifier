import React, { useState } from 'react';
import { Star } from 'lucide-react';

interface StarRatingProps {
  rating: number; // 0 to 5
  onRate: (newRating: number) => void;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

export const StarRating: React.FC<StarRatingProps> = ({
  rating,
  onRate,
  size = 'md',
  disabled = false,
}) => {
  const [hoverRating, setHoverRating] = useState<number | null>(null);

  const starSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  const currentDisplayRating = hoverRating !== null ? hoverRating : rating;

  return (
    <div
      className="flex items-center gap-0.5"
      onMouseLeave={() => setHoverRating(null)}
    >
      {[1, 2, 3, 4, 5].map(star => {
        const isFilled = currentDisplayRating >= star;
        const isHovered = hoverRating !== null && hoverRating >= star;

        return (
          <button
            key={star}
            type="button"
            disabled={disabled}
            onClick={e => {
              e.stopPropagation();
              onRate(rating === star ? 0 : star);
            }}
            onMouseEnter={() => setHoverRating(star)}
            className="p-0.5 hover:scale-125 transition-transform duration-100 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            title={`Set ${star} Star${star > 1 ? 's' : ''}`}
          >
            <Star
              className={`${starSizes[size]} transition-colors duration-100 ${
                isFilled
                  ? isHovered
                    ? 'text-amber-300 fill-amber-300'
                    : 'text-amber-400 fill-amber-400'
                  : 'text-gray-500 hover:text-amber-300'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
};
