import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  CombinedPhotoData,
  FilterSettings,
  FontSizeScale,
  FolderRecord,
  MLModelOption,
  PickStatus,
  ViewMode,
} from './types';
import { TopToolbar } from './components/TopToolbar';
import { LeftSidebar } from './components/LeftSidebar';
import { RightSidebar } from './components/RightSidebar';
import { GridView } from './components/GridView';
import { LoupeView } from './components/LoupeView';
import { CompareView } from './components/CompareView';
import { StatsDashboard } from './components/StatsDashboard';
import { Filmstrip } from './components/Filmstrip';
import {
  applyUiScale,
  getNextFontScale,
  getPrevFontScale,
  getThresholdMultiplier,
  PICK_RANDOM_BASELINE,
  RATING_RANDOM_BASELINE,
  shouldShowAiSuggestion,
} from './utils/ratingUtils';

export const App: React.FC = () => {
  // Sidebar Collapse States
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState<boolean>(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState<boolean>(false);

  // Active View Mode
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Application Settings (Confidence multiplier: default 1.5x baseline)
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(1.5);
  const [uiFontScale, setUiFontScale] = useState<FontSizeScale>('sm');
  const [colorblindMode, setColorblindMode] = useState<boolean>(true);

  // Apply UI Font Scale whenever it changes
  useEffect(() => {
    applyUiScale(uiFontScale);
  }, [uiFontScale]);

  // Data States
  const [folders, setFolders] = useState<(FolderRecord & { photoCount?: number })[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<CombinedPhotoData[]>([]);

  // Selection Queue States
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [compareQueue, setCompareQueue] = useState<CombinedPhotoData[]>([]);

  // Filters & Grid Config
  const [gridSize, setGridSize] = useState<number>(200);
  const [filters, setFilters] = useState<FilterSettings>({
    pickFilter: 'all',
    minRating: 0,
    maxRating: 5,
    showDisagreementsOnly: false,
    searchQuery: '',
  });

  // ML Models
  const [availableModels, setAvailableModels] = useState<MLModelOption[]>([]);
  const [activeModel, setActiveModel] = useState<MLModelOption | null>(null);

  // Background Import Progress State (x/y files ready)
  const [importProgress, setImportProgress] = useState<{
    folderId: string;
    current: number;
    total: number;
  } | null>(null);

  // Listen to background progress streams from Electron Main process
  useEffect(() => {
    if (!window.api) return;

    const unbindProgress = window.api.onImportProgress(data => {
      setImportProgress({ folderId: data.folderId, current: data.current, total: data.total });

      // Update folder list photo counts live in UI
      setFolders(prev =>
        prev.map(f => (f.id === data.folderId ? { ...f, photoCount: data.total } : f))
      );

      // Append or update photos in current view if active folder matches
      if (data.photo || data.photos) {
        const incoming: CombinedPhotoData[] = data.photos || (data.photo ? [data.photo] : []);
        if (incoming.length > 0) {
          setPhotos(prev => {
            const idMap = new Map<string, number>();
            for (let i = 0; i < prev.length; i++) {
              idMap.set(prev[i].photo.id, i);
            }
            const next = [...prev];
            for (const item of incoming) {
              const idx = idMap.get(item.photo.id);
              if (idx !== undefined) {
                next[idx] = item;
              } else {
                idMap.set(item.photo.id, next.length);
                next.push(item);
              }
            }
            return next;
          });
        }
      }
    });

    const unbindComplete = window.api.onImportComplete(data => {
      setImportProgress({ folderId: data.folderId, current: data.total, total: data.total });
      setTimeout(() => {
        setImportProgress(null);
      }, 2000);
    });

    return () => {
      unbindProgress();
      unbindComplete();
    };
  }, []);

  // Load Folders & Models on Init
  useEffect(() => {
    const defaultModels: MLModelOption[] = [
      {
        id: 'mobilenet_v3',
        name: 'MobileNetV3 Small (Local ONNX)',
        providerType: 'local_onnx',
        description: 'Lightweight on-device neural network for rapid aesthetic scoring',
        embeddingDim: 512,
        requiresApiKey: false,
        isOfflineCapable: true,
      },
      {
        id: 'clip_vit_b32',
        name: 'CLIP ViT-B/32 (Local ONNX)',
        providerType: 'local_onnx',
        description: 'High-semantic visual representation model (512-dim embedding vector)',
        embeddingDim: 512,
        requiresApiKey: false,
        isOfflineCapable: true,
      },
      {
        id: 'cloud_openai',
        name: 'OpenAI GPT-4o Vision API (Cloud)',
        providerType: 'cloud_openai',
        description: 'Cloud-assisted vision model for high-precision aesthetic features',
        embeddingDim: 512,
        requiresApiKey: true,
        isOfflineCapable: false,
      },
    ];

    if (window.api) {
      window.api
        .getFolders()
        .then(data => {
          setFolders(data);
          if (data.length > 0) {
            setActiveFolderId(data[0].id);
          }
        })
        .catch(console.error);

      window.api
        .getActiveModel()
        .then(model => {
          setActiveModel(model);
          setAvailableModels(defaultModels);
        })
        .catch(() => {
          setActiveModel(defaultModels[0]);
          setAvailableModels(defaultModels);
        });
    } else {
      // Browser fallback mode initialization
      setActiveModel(defaultModels[0]);
      setAvailableModels(defaultModels);

      // Seed initial sample shoot folder for browser testing
      const sampleFolderId = 'f_demo_shoot';
      const sampleFolder: FolderRecord & { photoCount: number } = {
        id: sampleFolderId,
        path: '/pictures/Demo_Shoot_2026',
        name: 'Demo Shoot 2026 (Web Preview)',
        created_at: Date.now(),
        photoCount: 6,
      };

      const samplePhotos: CombinedPhotoData[] = [1, 2, 3, 4, 5, 6].map(i => {
        const svgUri = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="%23${i % 2 === 0 ? '1e293b' : '1e1b4b'}"/><circle cx="${200 + i * 80}" cy="${200 + (i % 3) * 60}" r="${80 + i * 10}" fill="%23${i % 2 === 0 ? '38bdf8' : 'a855f7'}" opacity="0.8"/><text x="400" y="300" font-family="sans-serif" font-size="28" fill="%23f8fafc" text-anchor="middle">Demo Photo ${i}.jpg</text></svg>`;
        const photoId = `p_demo_${i}`;
        const pickStatus: PickStatus =
          i === 1 || i === 4 ? 'pick' : i === 6 ? 'reject' : 'unflagged';
        const rating = (i % 5) + 1;

        return {
          photo: {
            id: photoId,
            folder_id: sampleFolderId,
            file_path: svgUri,
            file_name: `Demo_Photo_${i}.jpg`,
            file_size: 2450000 + i * 150000,
            width: 3840,
            height: 2560,
            date_taken: Date.now() - i * 3600000,
            created_at: Date.now(),
            thumbnail_path: svgUri,
          },
          exif: {
            photo_id: photoId,
            camera_make: 'Sony',
            camera_model: 'ILCE-7RM4',
            lens_model: 'FE 85mm F1.4 GM',
            iso: 100 * i,
            aperture: 1.4,
            shutter_speed: `1/${250 * i}s`,
            focal_length: 85,
            exposure_bias: 0,
          },
          userRating: {
            photo_id: photoId,
            pick_status: pickStatus,
            star_rating: rating,
            is_confirmed: true,
            updated_at: Date.now(),
          },
          quality: {
            photo_id: photoId,
            blur_score: 92 - i * 3,
            is_black_frame: false,
            is_overexposed: false,
            mean_luminance: 120 + i * 5,
          },
          aiPrediction: {
            photo_id: photoId,
            provider_type: 'local_onnx',
            model_name: 'mobilenet_v3',
            predicted_pick: pickStatus,
            predicted_rating: rating,
            pick_confidence: 0.92,
            rating_confidence: 0.89,
            model_snapshot_id: null,
            updated_at: Date.now(),
          },
        };
      });

      setFolders([sampleFolder]);
      setActiveFolderId(sampleFolderId);
      setPhotos(samplePhotos);
      setSelectedPhotoId(samplePhotos[0].photo.id);
      setSelectedPhotoIds(new Set([samplePhotos[0].photo.id]));
    }
  }, []);

  // Fetch Photos when active folder changes
  useEffect(() => {
    if (!activeFolderId) return;

    if (window.api) {
      window.api
        .getPhotosInFolder(activeFolderId)
        .then(data => {
          setPhotos(data);
          if (data.length > 0) {
            setSelectedPhotoId(data[0].photo.id);
            setSelectedPhotoIds(new Set([data[0].photo.id]));
          } else {
            setSelectedPhotoId(null);
            setSelectedPhotoIds(new Set());
          }
        })
        .catch(console.error);
    }
  }, [activeFolderId]);

  // Open Folder Dialog Handler (Supports both Electron Native Dialog and Web Browser Directory Picker)
  const handleOpenFolderDialog = async () => {
    if (window.api) {
      const res = await window.api.selectFolder();
      if (res) {
        const importedFolder = await window.api.importFolder(res.path);
        const updatedFolders = await window.api.getFolders();
        setFolders(updatedFolders);
        setActiveFolderId(importedFolder.id);
      }
    } else {
      // Web browser directory selector fallback
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.setAttribute('webkitdirectory', '');
      fileInput.setAttribute('directory', '');
      fileInput.multiple = true;

      fileInput.onchange = async (e: Event) => {
        const target = e.target as HTMLInputElement;
        if (!target.files || target.files.length === 0) return;

        const files = Array.from(target.files);
        const validExts = new Set([
          '.jpg',
          '.jpeg',
          '.png',
          '.webp',
          '.tiff',
          '.cr2',
          '.nef',
          '.arw',
          '.dng',
        ]);
        const imageFiles = files.filter(file => {
          const ext = '.' + file.name.split('.').pop()?.toLowerCase();
          return validExts.has(ext);
        });

        if (imageFiles.length === 0) {
          alert('No supported image files found in the selected directory.');
          return;
        }

        const firstRelPath = imageFiles[0].webkitRelativePath || imageFiles[0].name;
        const folderName = firstRelPath.split('/')[0] || 'Selected Folder';
        const folderId = `f_web_${Date.now()}`;

        const newFolder: FolderRecord & { photoCount: number } = {
          id: folderId,
          path: folderName,
          name: folderName,
          created_at: Date.now(),
          photoCount: imageFiles.length,
        };

        const newPhotos: CombinedPhotoData[] = imageFiles.map((file, idx) => {
          const photoId = `p_web_${Date.now()}_${idx}`;
          const objectUrl = URL.createObjectURL(file);
          const predictedPick: PickStatus =
            idx % 3 === 0 ? 'pick' : idx % 5 === 0 ? 'reject' : 'unflagged';
          const predictedRating = (idx % 5) + 1;

          return {
            photo: {
              id: photoId,
              folder_id: folderId,
              file_path: objectUrl,
              file_name: file.name,
              file_size: file.size,
              width: 1920,
              height: 1080,
              date_taken: file.lastModified || Date.now(),
              created_at: Date.now(),
              thumbnail_path: objectUrl,
            },
            exif: {
              photo_id: photoId,
              camera_make: 'Camera',
              camera_model: 'Digital SLR',
              lens_model: '35mm F1.4',
              iso: 200,
              aperture: 1.4,
              shutter_speed: '1/1000s',
              focal_length: 35,
              exposure_bias: 0,
            },
            userRating: {
              photo_id: photoId,
              pick_status: 'unflagged',
              star_rating: 0,
              is_confirmed: false,
              updated_at: Date.now(),
            },
            quality: {
              photo_id: photoId,
              blur_score: 85,
              is_black_frame: false,
              is_overexposed: false,
              mean_luminance: 130,
            },
            aiPrediction: {
              photo_id: photoId,
              provider_type: 'local_onnx',
              model_name: 'mobilenet_v3',
              predicted_pick: predictedPick,
              predicted_rating: predictedRating,
              pick_confidence: 0.9,
              rating_confidence: 0.88,
              model_snapshot_id: null,
              updated_at: Date.now(),
            },
          };
        });

        setFolders(prev => [newFolder, ...prev]);
        setActiveFolderId(folderId);
        setPhotos(newPhotos);
        if (newPhotos.length > 0) {
          setSelectedPhotoId(newPhotos[0].photo.id);
          setSelectedPhotoIds(new Set([newPhotos[0].photo.id]));
        }
      };

      fileInput.click();
    }
  };

  // Filtered Photos Selector
  const filteredPhotos = useMemo(() => {
    return photos.filter(item => {
      const rating = item.userRating;
      const ai = item.aiPrediction;

      if (filters.pickFilter !== 'all') {
        const isNoneFilter =
          filters.pickFilter === 'none' || (filters.pickFilter as string) === 'unflagged';
        const isPhotoNone = rating.pick_status === 'none' || rating.pick_status === 'unflagged';
        if (isNoneFilter) {
          if (!isPhotoNone) return false;
        } else if (rating.pick_status !== filters.pickFilter) {
          return false;
        }
      }
      if (rating.star_rating < filters.minRating || rating.star_rating > filters.maxRating) {
        return false;
      }
      if (filters.showDisagreementsOnly) {
        if (!ai || ai.predicted_rating === rating.star_rating) {
          return false;
        }
      }
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        if (!item.photo.file_name.toLowerCase().includes(query)) return false;
      }
      return true;
    });
  }, [photos, filters]);

  // Active Selected Photo Object
  const selectedPhoto = useMemo(() => {
    return photos.find(p => p.photo.id === selectedPhotoId) || null;
  }, [photos, selectedPhotoId]);

  // Rating Update Handler
  const handleUpdateRating = useCallback(
    async (photoId: string, pickStatus: PickStatus, starRating: number) => {
      // If the target photo is part of a multi-selection, apply rating update to all selected photos
      const targetIds =
        selectedPhotoIds.has(photoId) && selectedPhotoIds.size > 1
          ? Array.from(selectedPhotoIds)
          : [photoId];

      // 1. Optimistically update local React state immediately for instant UI response
      setPhotos(prev =>
        prev.map(p => {
          if (targetIds.includes(p.photo.id)) {
            return {
              ...p,
              userRating: {
                ...p.userRating,
                pick_status: pickStatus,
                star_rating: starRating,
                is_confirmed: true,
                updated_at: Date.now(),
              },
            };
          }
          return p;
        })
      );

      // 2. Persist rating updates to backend DB if Tauri API is present
      if (window.api) {
        for (const id of targetIds) {
          try {
            const updated = await window.api.updateUserRating(id, pickStatus, starRating);
            setPhotos(prev =>
              prev.map(p => (p.photo.id === id ? { ...p, userRating: updated } : p))
            );
          } catch (err) {
            console.error('[App] Failed to update user rating in backend:', err);
          }
        }
      }
    },
    [selectedPhotoIds]
  );

  // One-Action AI Suggestion Acceptance Engine (Supports single photo & multi-selection batch)
  const handleAcceptAiSuggestion = useCallback(
    async (photoId: string) => {
      const targetIds =
        selectedPhotoIds.has(photoId) && selectedPhotoIds.size > 1
          ? Array.from(selectedPhotoIds)
          : [photoId];

      const updates: { photoId: string; pick: PickStatus; rating: number }[] = [];

      // 1. Optimistic UI update
      setPhotos(prev =>
        prev.map(item => {
          if (!targetIds.includes(item.photo.id)) return item;
          const ai = item.aiPrediction;
          if (!ai) return item;

          const multiplier = getThresholdMultiplier(confidenceThreshold);
          const meetsRatingConf =
            (ai.rating_confidence ?? 0) >= multiplier * RATING_RANDOM_BASELINE;
          const meetsPickConf = (ai.pick_confidence ?? 0) >= multiplier * PICK_RANDOM_BASELINE;
          if (!meetsRatingConf || !meetsPickConf) return item;

          const finalPick: PickStatus = ai.predicted_pick;
          const finalRating = ai.predicted_rating;

          updates.push({ photoId: item.photo.id, pick: finalPick, rating: finalRating });

          return {
            ...item,
            userRating: {
              ...item.userRating,
              pick_status: finalPick,
              star_rating: finalRating,
              is_confirmed: true,
              updated_at: Date.now(),
            },
          };
        })
      );

      // 2. Persist updates to SQLite backend
      if (window.api) {
        for (const update of updates) {
          try {
            const updated = await window.api.updateUserRating(
              update.photoId,
              update.pick,
              update.rating
            );
            setPhotos(prev =>
              prev.map(p => (p.photo.id === update.photoId ? { ...p, userRating: updated } : p))
            );
          } catch (err) {
            console.error('[App] Failed to update user rating on AI accept:', err);
          }
        }
      }
    },
    [selectedPhotoIds, confidenceThreshold]
  );

  // RawTherapee Exporter Handler
  const handleExportRawTherapee = async (
    photoPath: string,
    rating: number,
    pickStatus: PickStatus
  ) => {
    if (window.api) {
      await window.api.exportRawTherapee(photoPath, rating, pickStatus);
      alert(`Exported RawTherapee .pp3 sidecar for ${photoPath}`);
    } else {
      alert(
        `[Browser Preview Mode] Generated RawTherapee .pp3 sidecar for ${photoPath}\nRating: ${rating} Stars | Pick: ${pickStatus.toUpperCase()}`
      );
    }
  };

  // Select Photo Handler
  const handleSelectPhoto = (photoData: CombinedPhotoData, isMultiSelect: boolean = false) => {
    const id = photoData.photo.id;
    setSelectedPhotoId(id);

    if (isMultiSelect) {
      const next = new Set(selectedPhotoIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedPhotoIds(next);
    } else {
      setSelectedPhotoIds(new Set([id]));
    }
  };

  // Navigate Prev / Next Photo
  const handlePrevPhoto = () => {
    if (filteredPhotos.length === 0 || !selectedPhotoId) return;
    const idx = filteredPhotos.findIndex(p => p.photo.id === selectedPhotoId);
    if (idx > 0) {
      setSelectedPhotoId(filteredPhotos[idx - 1].photo.id);
      setSelectedPhotoIds(new Set([filteredPhotos[idx - 1].photo.id]));
    }
  };

  const handleNextPhoto = () => {
    if (filteredPhotos.length === 0 || !selectedPhotoId) return;
    const idx = filteredPhotos.findIndex(p => p.photo.id === selectedPhotoId);
    if (idx >= 0 && idx < filteredPhotos.length - 1) {
      setSelectedPhotoId(filteredPhotos[idx + 1].photo.id);
      setSelectedPhotoIds(new Set([filteredPhotos[idx + 1].photo.id]));
    }
  };

  // Mode Switcher Helper (Entering Compare Mode Populates Elimination Queue)
  const handleViewModeChange = (mode: ViewMode) => {
    if (mode === 'compare') {
      const queue = photos.filter(p => selectedPhotoIds.has(p.photo.id));
      setCompareQueue(queue.length >= 2 ? queue : photos.slice(0, 4));
    }
    setViewMode(mode);
  };

  // Elimination Compare Handler: Remove Candidate
  const handleRemoveCandidate = (photoId: string) => {
    setCompareQueue(prev => prev.filter(p => p.photo.id !== photoId));
  };

  // Global Ergonomic Keyboard Listener Engine
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore keybindings when typing inside input or editable elements
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

      const key = e.key.toUpperCase();
      const hasModifier = e.ctrlKey || e.metaKey;

      // Font Zoom Shortcuts (Ctrl/Cmd + +, Ctrl/Cmd + -, Ctrl/Cmd + 0)
      if (hasModifier && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setUiFontScale(prev => getNextFontScale(prev));
        return;
      }
      if (hasModifier && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        setUiFontScale(prev => getPrevFontScale(prev));
        return;
      }
      if (hasModifier && e.key === '0') {
        e.preventDefault();
        setUiFontScale('sm');
        return;
      }

      // Sidebar Toggle Hotkeys ([ for Left, ] for Right, Ctrl+B for Left, Shift+Tab for Right)
      if (e.key === '[') {
        e.preventDefault();
        setLeftSidebarCollapsed(prev => !prev);
        return;
      }
      if (e.key === ']') {
        e.preventDefault();
        setRightSidebarCollapsed(prev => !prev);
        return;
      }
      if (hasModifier && key === 'B') {
        e.preventDefault();
        setLeftSidebarCollapsed(prev => !prev);
        return;
      }

      // Predictive Tab Acceptance & Focus Navigation
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          // Shift+Tab toggles Right Inspector Sidebar
          setRightSidebarCollapsed(prev => !prev);
          return;
        }

        // Tab: Check if currently selected photo has valid unconfirmed AI suggestion
        if (selectedPhotoId) {
          const target = photos.find(p => p.photo.id === selectedPhotoId);
          const hasEligibleSuggestion =
            target &&
            shouldShowAiSuggestion(target.userRating, target.aiPrediction, confidenceThreshold);

          if (hasEligibleSuggestion) {
            handleAcceptAiSuggestion(selectedPhotoId);
            return;
          }
        }

        // Otherwise cycle to next unrated photo
        const currentIdx = filteredPhotos.findIndex(p => p.photo.id === selectedPhotoId);
        let nextUnrated = filteredPhotos
          .slice(currentIdx + 1)
          .find(
            p =>
              !p.userRating.is_confirmed &&
              p.userRating.star_rating === 0 &&
              p.userRating.pick_status === 'unflagged'
          );
        if (!nextUnrated) {
          nextUnrated = filteredPhotos
            .slice(0, currentIdx)
            .find(
              p =>
                !p.userRating.is_confirmed &&
                p.userRating.star_rating === 0 &&
                p.userRating.pick_status === 'unflagged'
            );
        }

        if (nextUnrated) {
          setSelectedPhotoId(nextUnrated.photo.id);
          setSelectedPhotoIds(new Set([nextUnrated.photo.id]));
        } else {
          handleNextPhoto();
        }
        return;
      }

      // View Switching Hotkeys
      if (key === 'G') handleViewModeChange('grid');
      if (key === 'E' || e.key === 'Enter') handleViewModeChange('loupe');
      if (key === 'C') handleViewModeChange('compare');
      if (key === 'S') handleViewModeChange('stats');

      // Compare View Elimination Hotkey (\ or Delete or Backspace)
      if (
        viewMode === 'compare' &&
        (e.key === '\\' || e.key === 'Delete' || e.key === 'Backspace')
      ) {
        e.preventDefault();
        if (selectedPhotoId) handleRemoveCandidate(selectedPhotoId);
      }

      // Navigation Keys
      if (e.key === 'ArrowLeft') handlePrevPhoto();
      if (e.key === 'ArrowRight') handleNextPhoto();

      // Rating Keys (P, X, U, 0 to 5)
      if (selectedPhotoId) {
        const currentPick = selectedPhoto?.userRating.pick_status || 'none';
        const currentStar = selectedPhoto?.userRating.star_rating || 0;

        if (key === 'P') {
          handleUpdateRating(
            selectedPhotoId,
            currentPick === 'pick' ? 'none' : 'pick',
            currentStar
          );
        }
        if (key === 'X') {
          handleUpdateRating(
            selectedPhotoId,
            currentPick === 'reject' ? 'none' : 'reject',
            currentStar
          );
        }
        if (key === 'U') {
          handleUpdateRating(selectedPhotoId, 'none', currentStar);
        }

        if (['0', '1', '2', '3', '4', '5'].includes(e.key)) {
          const newStar = Number(e.key);
          handleUpdateRating(selectedPhotoId, currentPick, currentStar === newStar ? 0 : newStar);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedPhotoId,
    selectedPhoto,
    viewMode,
    photos,
    filteredPhotos,
    selectedPhotoIds,
    confidenceThreshold,
    handleAcceptAiSuggestion,
    handleUpdateRating,
  ]);

  // Clear Database Handler
  const handleClearDatabase = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to clear the local database and remove all cached thumbnails and ratings?'
    );
    if (!confirmed) return;

    if (window.api) {
      await window.api.clearDatabase();
    }
    setFolders([]);
    setActiveFolderId(null);
    setPhotos([]);
    setSelectedPhotoId(null);
    setSelectedPhotoIds(new Set());
    setCompareQueue([]);
  };

  const activeFolder = folders.find(f => f.id === activeFolderId);

  return (
    <div className="w-screen h-screen bg-[#121316] flex flex-col overflow-hidden text-gray-200">
      {/* Top Navigation & Filters Bar */}
      <TopToolbar
        viewMode={viewMode}
        onChangeViewMode={handleViewModeChange}
        availableModels={availableModels}
        activeModel={activeModel}
        onChangeModel={id => {
          if (window.api) window.api.setActiveModel(id).then(setActiveModel);
        }}
        filters={filters}
        onChangeFilters={setFilters}
        gridSize={gridSize}
        onChangeGridSize={setGridSize}
        uiFontScale={uiFontScale}
        onChangeFontScale={setUiFontScale}
        confidenceThreshold={confidenceThreshold}
        onChangeConfidenceThreshold={setConfidenceThreshold}
        colorblindMode={colorblindMode}
        onToggleColorblindMode={() => setColorblindMode(prev => !prev)}
        activeFolderName={activeFolder?.name}
        totalPhotosCount={photos.length}
        filteredPhotosCount={filteredPhotos.length}
        importProgress={importProgress}
      />

      {/* Main 3-Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Collapsible Left Folder Sidebar */}
        <LeftSidebar
          isCollapsed={leftSidebarCollapsed}
          onToggleCollapse={() => setLeftSidebarCollapsed(prev => !prev)}
          folders={folders}
          activeFolderId={activeFolderId}
          onSelectFolder={setActiveFolderId}
          onOpenFolderDialog={handleOpenFolderDialog}
          onClearDatabase={handleClearDatabase}
        />

        {/* Center Main Viewport */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#121316] relative">
          {viewMode === 'grid' && (
            <GridView
              photos={filteredPhotos}
              selectedPhotoId={selectedPhotoId}
              selectedPhotoIds={selectedPhotoIds}
              onSelectPhoto={handleSelectPhoto}
              onUpdateRating={handleUpdateRating}
              onAcceptAiSuggestion={handleAcceptAiSuggestion}
              confidenceThreshold={confidenceThreshold}
              gridSize={gridSize}
            />
          )}

          {viewMode === 'loupe' && (
            <LoupeView
              selectedPhoto={selectedPhoto}
              onUpdateRating={handleUpdateRating}
              onAcceptAiSuggestion={handleAcceptAiSuggestion}
              confidenceThreshold={confidenceThreshold}
              onNextPhoto={handleNextPhoto}
              onPrevPhoto={handlePrevPhoto}
            />
          )}

          {viewMode === 'compare' && (
            <CompareView
              candidates={compareQueue}
              onRemoveCandidate={handleRemoveCandidate}
              onUpdateRating={handleUpdateRating}
              onAcceptAiSuggestion={handleAcceptAiSuggestion}
              confidenceThreshold={confidenceThreshold}
              onSelectWinner={photoData => {
                setSelectedPhotoId(photoData.photo.id);
                setViewMode('loupe');
              }}
            />
          )}

          {viewMode === 'stats' && (
            <StatsDashboard
              onRetrainAI={async () => {
                if (window.api) {
                  await window.api.retrainAI();
                  // Re-fetch updated predictions for current folder
                  if (activeFolderId) {
                    const refreshed = await window.api.getPhotosInFolder(activeFolderId);
                    setPhotos(prev =>
                      refreshed.map(r => {
                        const existing = prev.find(p => p.photo.id === r.photo.id);
                        if (existing && existing.userRating.is_confirmed) {
                          // Confirmed photos keep user ratings intact while updating underlying prediction
                          return {
                            ...r,
                            userRating: existing.userRating,
                          };
                        }
                        return r;
                      })
                    );
                  }
                }
              }}
              onAuditDisagreements={() => {
                setFilters({ ...filters, showDisagreementsOnly: true });
                setViewMode('grid');
              }}
            />
          )}

          {/* Bottom Persistent Filmstrip Bar for Loupe & Compare View */}
          {(viewMode === 'loupe' || viewMode === 'compare') && (
            <Filmstrip
              photos={filteredPhotos}
              selectedPhotoId={selectedPhotoId}
              onSelectPhoto={item => handleSelectPhoto(item, false)}
            />
          )}
        </main>

        {/* Collapsible Right Metadata & Histogram Sidebar */}
        <RightSidebar
          isCollapsed={rightSidebarCollapsed}
          onToggleCollapse={() => setRightSidebarCollapsed(prev => !prev)}
          selectedPhoto={selectedPhoto}
          onUpdateRating={handleUpdateRating}
          onExportRawTherapee={handleExportRawTherapee}
          confidenceThreshold={confidenceThreshold}
        />
      </div>
    </div>
  );
};
