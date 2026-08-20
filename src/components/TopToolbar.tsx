import React from 'react';
import { FilterSettings, FontSizeScale, FONT_SCALES, MLModelOption, ViewMode } from '../types';
import {
  LayoutGrid,
  Maximize2,
  Columns,
  BarChart3,
  Cpu,
  AlertTriangle,
  Sliders,
  Type,
  Sparkles,
  Eye,
} from 'lucide-react';

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
  uiFontScale: FontSizeScale;
  onChangeFontScale: (scale: FontSizeScale) => void;
  confidenceThreshold: number;
  onChangeConfidenceThreshold: (threshold: number) => void;
  colorblindMode?: boolean;
  onToggleColorblindMode?: () => void;
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
  uiFontScale,
  onChangeFontScale,
  confidenceThreshold,
  onChangeConfidenceThreshold,
  colorblindMode = true,
  onToggleColorblindMode,
  activeFolderName,
  totalPhotosCount,
  filteredPhotosCount,
  importProgress,
}) => {
  return (
    <header className="h-14 bg-[#1a1c23] border-b border-[#2a2d3a] px-4 flex items-center justify-between z-30 flex-shrink-0 select-none">
      {/* Left: View Mode Switcher */}
      <div className="flex items-center gap-3">
        <div className="flex bg-[#141519] p-1 rounded-lg border border-[#2a2d3a]">
          <button
            onClick={() => onChangeViewMode('grid')}
            title="Grid View (G)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
              viewMode === 'grid'
                ? 'bg-amber-500 text-gray-950 font-bold shadow-md'
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
                ? 'bg-amber-500 text-gray-950 font-bold shadow-md'
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
                ? 'bg-amber-500 text-gray-950 font-bold shadow-md'
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
                ? 'bg-amber-500 text-gray-950 font-bold shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-[#262933]'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>AI Stats (S)</span>
          </button>
        </div>

        {/* Active Folder Title & Count */}
        <div className="hidden md:flex items-center gap-2 border-l border-[#2a2d3a] pl-3 text-xs">
          <span className="font-semibold text-white">
            {activeFolderName || 'No Folder Selected'}
          </span>
          <span className="text-gray-500 font-mono text-[11px]">
            ({filteredPhotosCount} / {totalPhotosCount} photos)
          </span>
        </div>

        {/* Live Progress Bar Badge (x/y files ready, no distracting pulse) */}
        {importProgress && importProgress.total > 0 && (
          <div className="flex items-center gap-2 bg-[#0c2340] border border-sky-500/50 px-3 py-1 rounded-full text-xs">
            <span className="text-sky-300 font-medium">
              Preparing files: {importProgress.current} / {importProgress.total} ready (
              {Math.round((importProgress.current / importProgress.total) * 100)}%)
            </span>
            <div className="w-16 bg-sky-950 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-sky-400 h-full transition-all duration-200"
                style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Middle: ML Model Selector Dropdown & Confidence Threshold */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 bg-[#141519] px-3 py-1.5 rounded-lg border border-[#2a2d3a] text-xs">
          <Cpu className="w-3.5 h-3.5 text-sky-400" />
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

        {/* Confidence Gating Multiplier Control (Requires both rating and pick to beat random baseline by N×) */}
        <div className="hidden lg:flex items-center gap-1.5 bg-[#141519] px-2.5 py-1.5 rounded-lg border border-[#2a2d3a] text-xs">
          <Sparkles className="w-3.5 h-3.5 text-sky-400" />
          <span
            className="text-gray-400"
            title="Minimum certainty multiplier over random chance required for both Star Rating (16.7% baseline) and Pick Flag (33.3% baseline)"
          >
            Min Multiplier:
          </span>
          <select
            value={confidenceThreshold}
            onChange={e => onChangeConfidenceThreshold(Number(e.target.value))}
            className="bg-transparent text-sky-300 font-mono font-medium focus:outline-none cursor-pointer"
            title="Threshold Multiplier: requires both rating and pick certainty to be at least N× above uniform random chance"
          >
            <option value={1.0} className="bg-[#1a1c23] text-gray-200">
              1.0× Baseline (Show All · Rating ≥16.7%, Pick ≥33.3%)
            </option>
            <option value={1.2} className="bg-[#1a1c23] text-gray-200">
              1.2× Chance (Lenient · Rating ≥20%, Pick ≥40%)
            </option>
            <option value={1.5} className="bg-[#1a1c23] text-gray-200">
              1.5× Chance (Balanced · Rating ≥25%, Pick ≥50%)
            </option>
            <option value={1.8} className="bg-[#1a1c23] text-gray-200">
              1.8× Chance (Selective · Rating ≥30%, Pick ≥60%)
            </option>
            <option value={2.1} className="bg-[#1a1c23] text-gray-200">
              2.1× Chance (High · Rating ≥35%, Pick ≥70%)
            </option>
            <option value={2.4} className="bg-[#1a1c23] text-gray-200">
              2.4× Chance (Very High · Rating ≥40%, Pick ≥80%)
            </option>
            <option value={2.7} className="bg-[#1a1c23] text-gray-200">
              2.7× Chance (Ultra Strict · Rating ≥45%, Pick ≥90%)
            </option>
          </select>
        </div>
      </div>

      {/* Right: Filters, UI Zoom & Size Slider */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* UI Font Zoom Selector */}
        <div className="flex items-center gap-1.5 bg-[#141519] px-2 py-1.5 rounded-lg border border-[#2a2d3a] text-xs">
          <Type className="w-3.5 h-3.5 text-gray-400" />
          <select
            value={uiFontScale}
            onChange={e => onChangeFontScale(e.target.value as FontSizeScale)}
            className="bg-transparent text-gray-300 text-xs focus:outline-none cursor-pointer"
            title="UI Font Zoom Level (Ctrl + / Ctrl -)"
          >
            {Object.entries(FONT_SCALES).map(([key, item]) => (
              <option key={key} value={key} className="bg-[#1a1c23] text-gray-200">
                {item.label}
              </option>
            ))}
          </select>
        </div>

        {/* Accessibility Mode Indicator */}
        {onToggleColorblindMode && (
          <button
            onClick={onToggleColorblindMode}
            title={colorblindMode ? 'Colorblind Mode Active (High-Contrast)' : 'Standard Mode'}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition ${
              colorblindMode
                ? 'bg-sky-950/60 text-sky-300 border-sky-500/50'
                : 'bg-[#141519] text-gray-400 border-[#2a2d3a]'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span className="hidden xl:inline text-[11px]">Accessible</span>
          </button>
        )}

        {/* Disagreement Auditor Button */}
        <button
          onClick={() =>
            onChangeFilters({ ...filters, showDisagreementsOnly: !filters.showDisagreementsOnly })
          }
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

        {/* Pick Status Filter (Green Pick / Red Reject) */}
        <select
          value={filters.pickFilter}
          onChange={e =>
            onChangeFilters({
              ...filters,
              pickFilter: e.target.value as 'all' | 'pick' | 'reject' | 'unflagged',
            })
          }
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
              className="w-20 accent-amber-500 cursor-pointer"
              title="Adjust Thumbnail Size"
            />
          </div>
        )}
      </div>
    </header>
  );
};
