import React from 'react';
import { FilterSettings, MLModelOption, ViewMode } from '../types';
import { LayoutGrid, Maximize2, Columns, BarChart3, Filter, Cpu, Check, AlertTriangle, Search, Sliders } from 'lucide-react';

interface TopToolbarProps {
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  availableModels: MLModelOption[];
  activeModel: MLModelOption | null;
  onChangeModel: (modelId: string) => void;
  filters: FilterSettings;
  onChangeFilters: (filters: FilterSettings) => void;
  gridSize: number;
  onChangeGridSize: (size: number) => void;
  activeFolderName?: string;
  totalPhotosCount: number;
  filteredPhotosCount: number;
  importProgress?: { current: number; total: number } | null;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  viewMode,
  onChangeViewMode,
  availableModels,
  activeModel,
  onChangeModel,
  filters,
  onChangeFilters,
  gridSize,
  onChangeGridSize,
  activeFolderName,
  totalPhotosCount,
  filteredPhotosCount,
  importProgress,
}) => {
  return (
    <header className="h-14 bg-[#1a1c23] border-b border-[#2a2d3a] px-4 flex items-center justify-between z-30 flex-shrink-0">
      {/* Left: View Mode Switcher */}
      <div className="flex items-center gap-3">
        <div className="flex bg-[#141519] p-1 rounded-lg border border-[#2a2d3a]">
          <button
            onClick={() => onChangeViewMode('grid')}
            title="Grid View (G)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
              viewMode === 'grid'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-[#262933]'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Grid (G)</span>
          </button>

          <button
            onClick={() => onChangeViewMode('loupe')}
            title="Loupe View (E)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
              viewMode === 'loupe'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-[#262933]'
            }`}
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Loupe (E)</span>
          </button>

          <button
            onClick={() => onChangeViewMode('compare')}
            title="Multi-Compare Elimination Mode (C)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
              viewMode === 'compare'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-[#262933]'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Compare (C)</span>
          </button>

          <button
            onClick={() => onChangeViewMode('stats')}
            title="AI Analytics & Accuracy Stats (S)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
              viewMode === 'stats'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-[#262933]'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>AI Stats (S)</span>
          </button>
        </div>

        {/* Active Folder Title & Count */}
        <div className="hidden md:flex items-center gap-2 border-l border-[#2a2d3a] pl-3 text-xs">
          <span className="font-semibold text-white">{activeFolderName || 'No Folder Selected'}</span>
          <span className="text-gray-500 font-mono text-[11px]">
            ({filteredPhotosCount} / {totalPhotosCount} photos)
          </span>
        </div>

        {/* Live Progress Bar Badge (x/y files ready) */}
        {importProgress && importProgress.total > 0 && (
          <div className="flex items-center gap-2 bg-purple-950/60 border border-purple-500/50 px-3 py-1 rounded-full text-xs animate-pulse">
            <span className="text-purple-300 font-medium">
              Preparing files: {importProgress.current} / {importProgress.total} ready ({Math.round((importProgress.current / importProgress.total) * 100)}%)
            </span>
            <div className="w-16 bg-purple-900 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-purple-400 h-full transition-all duration-200"
                style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Middle: ML Model Selector Dropdown */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 bg-[#141519] px-3 py-1.5 rounded-lg border border-[#2a2d3a] text-xs">
          <Cpu className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-gray-400 hidden lg:inline">ML Model:</span>
          <select
            value={activeModel?.id || ''}
            onChange={e => onChangeModel(e.target.value)}
            className="bg-transparent text-white font-medium focus:outline-none cursor-pointer pr-2"
          >
            {availableModels.map(model => (
              <option key={model.id} value={model.id} className="bg-[#1a1c23] text-gray-200">
                {model.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Right: Filters & Zoom Slider */}
      <div className="flex items-center gap-3">
        {/* Disagreement Auditor Button */}
        <button
          onClick={() => onChangeFilters({ ...filters, showDisagreementsOnly: !filters.showDisagreementsOnly })}
          title="Filter AI Disagreements (where AI predicted rating differs from your rating)"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition border ${
            filters.showDisagreementsOnly
              ? 'bg-amber-950/60 text-amber-300 border-amber-500/50 shadow-sm'
              : 'bg-[#141519] text-gray-400 hover:text-white border-[#2a2d3a]'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">AI Disagreements</span>
        </button>

        {/* Pick Status Filter */}
        <select
          value={filters.pickFilter}
          onChange={e => onChangeFilters({ ...filters, pickFilter: e.target.value as any })}
          className="bg-[#141519] text-gray-300 text-xs px-2.5 py-1.5 rounded-lg border border-[#2a2d3a] focus:outline-none cursor-pointer"
        >
          <option value="all">All Flags</option>
          <option value="pick">Picks Only (Green)</option>
          <option value="reject">Rejects Only (Red)</option>
          <option value="unflagged">Unflagged Only</option>
        </select>

        {/* Thumbnail Size Slider (For Grid View) */}
        {viewMode === 'grid' && (
          <div className="hidden sm:flex items-center gap-2 bg-[#141519] px-2.5 py-1.5 rounded-lg border border-[#2a2d3a]">
            <Sliders className="w-3.5 h-3.5 text-gray-500" />
            <input
              type="range"
              min="140"
              max="340"
              step="20"
              value={gridSize}
              onChange={e => onChangeGridSize(Number(e.target.value))}
              className="w-20 accent-purple-500 cursor-pointer"
              title="Adjust Thumbnail Size"
            />
          </div>
        )}
      </div>
    </header>
  );
};
