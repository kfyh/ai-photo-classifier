import React from 'react';
import { FolderRecord } from '../types';
import {
  FolderOpen,
  Folder,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Sparkles,
  Trash2,
} from 'lucide-react';

interface LeftSidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  folders: (FolderRecord & { photoCount?: number })[];
  activeFolderId: string | null;
  onSelectFolder: (folderId: string) => void;
  onOpenFolderDialog: () => void;
  onClearDatabase?: () => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  isCollapsed,
  onToggleCollapse,
  folders,
  activeFolderId,
  onSelectFolder,
  onOpenFolderDialog,
  onClearDatabase,
}) => {
  if (isCollapsed) {
    return (
      <div className="w-12 bg-[#1a1c23] border-r border-[#2a2d3a] flex flex-col items-center py-3 gap-4 z-20">
        <button
          onClick={onToggleCollapse}
          title="Expand Left Folder Sidebar (Tab)"
          className="p-2 text-gray-400 hover:text-white hover:bg-[#262933] rounded-lg transition"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        <button
          onClick={onOpenFolderDialog}
          title="Select Photo Folder"
          className="p-2 text-purple-400 hover:text-purple-300 hover:bg-purple-950/40 rounded-lg transition"
        >
          <FolderOpen className="w-5 h-5" />
        </button>
        {onClearDatabase && (
          <button
            onClick={onClearDatabase}
            title="Clear Database & Cache"
            className="p-2 text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded-lg transition mt-auto"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <aside className="w-64 bg-[#1a1c23] border-r border-[#2a2d3a] flex flex-col h-full z-20 flex-shrink-0">
      {/* Header with collapse toggle */}
      <div className="p-3 border-b border-[#2a2d3a] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Folder className="w-4 h-4 text-purple-400" />
          <span className="text-xs font-semibold tracking-wider text-gray-300 uppercase">
            Folders
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onClearDatabase && (
            <button
              onClick={onClearDatabase}
              title="Clear Database & Reset All Data"
              className="p-1 text-gray-500 hover:text-red-400 hover:bg-red-950/30 rounded transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onToggleCollapse}
            title="Collapse Sidebar (Tab)"
            className="p-1 text-gray-400 hover:text-white hover:bg-[#262933] rounded transition"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Prominent Open / Select Folder Button */}
      <div className="p-3">
        <button
          onClick={onOpenFolderDialog}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-lg shadow-lg shadow-purple-950/50 transition duration-150 active:scale-[0.98]"
        >
          <FolderOpen className="w-4 h-4" />
          <span>Open / Select Folder</span>
        </button>
      </div>

      {/* Folders List */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
        {folders.length === 0 ? (
          <div className="p-4 text-center text-xs text-gray-500 space-y-2">
            <ImageIcon className="w-8 h-8 mx-auto text-gray-600 opacity-60" />
            <p>No shoot folders imported yet.</p>
            <p className="text-[11px] text-gray-600">
              Click "Open / Select Folder" above to start culling.
            </p>
          </div>
        ) : (
          folders.map(folder => {
            const isActive = folder.id === activeFolderId;
            return (
              <button
                key={folder.id}
                onClick={() => onSelectFolder(folder.id)}
                className={`w-full flex items-center justify-between p-2.5 rounded-lg text-xs text-left transition ${
                  isActive
                    ? 'bg-purple-950/40 text-purple-200 font-medium border border-purple-500/40 shadow-sm'
                    : 'text-gray-300 hover:bg-[#262933] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <Folder
                    className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-purple-400' : 'text-gray-400'}`}
                  />
                  <span className="truncate">{folder.name}</span>
                </div>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono flex-shrink-0 ${
                    isActive ? 'bg-purple-800/60 text-purple-200' : 'bg-[#141519] text-gray-500'
                  }`}
                >
                  {folder.photoCount || 0}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Bottom Status Info */}
      <div className="p-3 border-t border-[#2a2d3a] text-[11px] text-gray-400 flex items-center justify-between bg-[#141519]">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span>AI Transfer Engine</span>
        </div>
        <span className="text-[10px] text-green-400 font-medium px-1.5 py-0.5 bg-green-950/40 rounded border border-green-800/40">
          Ready
        </span>
      </div>
    </aside>
  );
};
