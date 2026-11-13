import React from 'react';
import { ViewMode } from '../types';
import { LayoutGrid, Maximize2, Columns } from 'lucide-react';

interface BottomRibbonProps {
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  selectedPhotoName?: string;
  selectedCount: number;
  filteredPhotosCount: number;
  totalPhotosCount: number;
}

const VIEW_OPTIONS: {
  mode: Extract<ViewMode, 'grid' | 'loupe' | 'compare'>;
  label: string;
  shortcut: string;
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    mode: 'grid',
    label: 'Grid',
    shortcut: 'G',
    title: 'Grid View (G)',
    Icon: LayoutGrid,
  },
  {
    mode: 'loupe',
    label: 'Loupe',
    shortcut: 'E',
    title: 'Loupe View (E)',
    Icon: Maximize2,
  },
  {
    mode: 'compare',
    label: 'Compare',
    shortcut: 'C',
    title: 'Compare View (C)',
    Icon: Columns,
  },
];

/** Persistent bottom tool ribbon for switching between Grid, Loupe, and Compare views. */
export const BottomRibbon: React.FC<BottomRibbonProps> = ({
  viewMode,
  onChangeViewMode,
  selectedPhotoName,
  selectedCount,
  filteredPhotosCount,
  totalPhotosCount,
}) => {
  return (
    <footer className="h-10 bg-[#1a1c23] border-t border-[#2a2d3a] px-4 flex items-center justify-between gap-3 z-30 flex-shrink-0 select-none">
      {/* Left: Active Photo Summary */}
      <div className="flex-1 min-w-0 hidden sm:flex items-center gap-2 text-xs text-gray-400">
        {selectedPhotoName ? (
          <span className="truncate font-medium text-gray-300" title={selectedPhotoName}>
            {selectedPhotoName}
          </span>
        ) : (
          <span className="text-gray-500">No photo selected</span>
        )}
        {selectedCount > 1 && (
          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono text-[10px] flex-shrink-0">
            {selectedCount} selected
          </span>
        )}
      </div>

      {/* Center: Three-View Switcher */}
      <nav
        aria-label="View switcher"
        className="flex items-center bg-[#141519] p-0.5 rounded-lg border border-[#2a2d3a] gap-1 mx-auto"
      >
        {VIEW_OPTIONS.map(({ mode, label, shortcut, title, Icon }) => {
          const isActive = viewMode === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={isActive}
              title={title}
              onClick={e => {
                onChangeViewMode(mode);
                e.currentTarget.blur();
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                isActive
                  ? 'bg-amber-500 text-gray-950 font-bold shadow-sm'
                  : 'text-gray-400 hover:text-white hover:bg-[#262933]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
              <span
                className={`text-[10px] font-mono ${
                  isActive ? 'text-gray-900/80' : 'text-gray-500'
                }`}
              >
                ({shortcut})
              </span>
            </button>
          );
        })}
      </nav>

      {/* Right: Filtered / Total Photo Count */}
      <div className="flex-1 min-w-0 hidden sm:flex items-center justify-end text-[11px] font-mono text-gray-500">
        <span>
          {filteredPhotosCount} / {totalPhotosCount} photos
        </span>
      </div>
    </footer>
  );
};
