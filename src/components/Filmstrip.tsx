import React from 'react';
import { CombinedPhotoData } from '../types';
import { CheckCircle2, XCircle } from 'lucide-react';
import { getPhotoSrc } from '../utils/image';

interface FilmstripProps {
  photos: CombinedPhotoData[];
  selectedPhotoId: string | null;
  onSelectPhoto: (photo: CombinedPhotoData) => void;
}

export const Filmstrip: React.FC<FilmstripProps> = ({ photos, selectedPhotoId, onSelectPhoto }) => {
  if (photos.length === 0) return null;

  return (
    <div className="h-20 bg-[#141519] border-t border-[#2a2d3a] px-3 flex items-center gap-2 overflow-x-auto z-20 flex-shrink-0">
      {photos.map(item => {
        const photo = item.photo;
        const rating = item.userRating;
        const isSelected = photo.id === selectedPhotoId;

        return (
          <button
            key={photo.id}
            onClick={() => onSelectPhoto(item)}
            className={`relative h-14 w-14 rounded-lg overflow-hidden flex-shrink-0 border transition ${
              isSelected
                ? 'border-amber-400 ring-2 ring-amber-400/50 scale-105'
                : 'border-[#2a2d3a] hover:border-gray-500 opacity-70 hover:opacity-100'
            }`}
          >
            <img
              src={getPhotoSrc(photo.thumbnail_path || photo.file_path)}
              alt={photo.file_name}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={e => {
                const target = e.currentTarget;
                const altSrc = getPhotoSrc(photo.file_path);
                if (altSrc && target.src !== altSrc) {
                  target.src = altSrc;
                }
              }}
            />

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
    </div>
  );
};
