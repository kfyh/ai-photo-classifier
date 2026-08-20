import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import {
  AccuracyLog,
  CombinedPhotoData,
  FolderRecord,
  ImportProgressData,
  MLModelOption,
  PickStatus,
  UserRating,
  PhotoRecord,
  PhotoExif,
  QualityMetrics,
  AIPrediction,
} from '../types';

export interface BackendCombinedPhotoData {
  photo: PhotoRecord;
  exif?: PhotoExif;
  user_rating?: UserRating;
  userRating?: UserRating;
  quality?: QualityMetrics;
  ai_prediction?: AIPrediction;
  aiPrediction?: AIPrediction;
}

export function normalizeCombinedPhoto(item: BackendCombinedPhotoData): CombinedPhotoData {
  const p = item.photo;
  const ex = item.exif;
  const r = item.user_rating || item.userRating;
  const q = item.quality;
  const ai = item.ai_prediction || item.aiPrediction;

  return {
    photo: {
      id: p.id,
      folder_id: p.folder_id,
      file_path: p.file_path,
      file_name: p.file_name,
      file_size: p.file_size,
      width: p.width,
      height: p.height,
      date_taken: p.date_taken,
      created_at: p.created_at,
      thumbnail_path: p.thumbnail_path,
      processing_status: p.processing_status,
      histogram_json: p.histogram_json,
    },
    exif: ex
      ? {
          photo_id: ex.photo_id,
          camera_make: ex.camera_make,
          camera_model: ex.camera_model,
          lens_model: ex.lens_model,
          iso: ex.iso,
          aperture: ex.aperture,
          shutter_speed: ex.shutter_speed,
          focal_length: ex.focal_length,
          exposure_bias: ex.exposure_bias,
        }
      : undefined,
    userRating: {
      photo_id: r?.photo_id || p.id,
      pick_status: (r?.pick_status || 'unflagged') as PickStatus,
      star_rating: r?.star_rating ?? 0,
      is_confirmed: r?.is_confirmed ?? false,
      updated_at: r?.updated_at || Date.now(),
    },
    quality: q
      ? {
          photo_id: q.photo_id,
          blur_score: q.blur_score,
          is_black_frame: q.is_black_frame,
          is_overexposed: q.is_overexposed,
          mean_luminance: q.mean_luminance,
        }
      : undefined,
    aiPrediction: ai
      ? {
          photo_id: ai.photo_id,
          provider_type: ai.provider_type,
          model_name: ai.model_name,
          predicted_pick: (ai.predicted_pick || 'unflagged') as PickStatus,
          predicted_rating: ai.predicted_rating ?? 0,
          pick_confidence: ai.pick_confidence ?? 0,
          rating_confidence: ai.rating_confidence ?? 0,
          model_snapshot_id: ai.model_snapshot_id ?? null,
          updated_at: ai.updated_at || Date.now(),
        }
      : undefined,
  };
}

export interface TauriAPI {
  selectFolder: () => Promise<{ path: string; name: string } | null>;
  getFolders: () => Promise<(FolderRecord & { photoCount?: number })[]>;
  importFolder: (folderPath: string) => Promise<FolderRecord>;
  getPhotosInFolder: (folderId: string) => Promise<CombinedPhotoData[]>;
  updateUserRating: (
    photoId: string,
    pickStatus: PickStatus,
    starRating: number
  ) => Promise<UserRating>;
  getHistogram: (
    imagePath: string,
    photoId?: string
  ) => Promise<{ red: number[]; green: number[]; blue: number[]; luma: number[] }>;
  getActiveModel: () => Promise<MLModelOption>;
  setActiveModel: (modelId: string) => Promise<MLModelOption>;
  retrainAI: () => Promise<{ log: AccuracyLog; snapshotId: string }>;
  getAccuracyLogs: () => Promise<AccuracyLog[]>;
  exportRawTherapee: (photoPath: string, rating: number, pickStatus: PickStatus) => Promise<string>;
  clearDatabase: () => Promise<boolean>;
  onImportProgress: (callback: (data: ImportProgressData) => void) => () => void;
  onImportComplete: (callback: (data: { folderId: string; total: number }) => void) => () => void;
}

export const tauriApi: TauriAPI = {
  selectFolder: async () => {
    try {
      const res = await invoke<FolderRecord | null>('select_folder');
      if (!res) return null;
      return { path: res.path, name: res.name };
    } catch (err) {
      console.error('[TauriAPI] selectFolder error:', err);
      return null;
    }
  },

  getFolders: async () => {
    try {
      const folders = await invoke<FolderRecord[]>('get_folders');
      return folders.map(f => ({
        ...f,
        photoCount: f.photoCount ?? (f as FolderRecord & { photo_count?: number }).photo_count,
      }));
    } catch (err) {
      console.error('[TauriAPI] getFolders error:', err);
      return [];
    }
  },

  importFolder: async (folderPath: string) => {
    return await invoke<FolderRecord>('import_folder', { folderPath });
  },

  getPhotosInFolder: async (folderId: string) => {
    try {
      const raw = await invoke<BackendCombinedPhotoData[]>('get_photos_in_folder', { folderId });
      return raw.map(normalizeCombinedPhoto);
    } catch (err) {
      console.error('[TauriAPI] getPhotosInFolder error:', err);
      return [];
    }
  },

  updateUserRating: async (photoId: string, pickStatus: PickStatus, starRating: number) => {
    try {
      const raw = await invoke<UserRating>('update_user_rating', {
        photoId,
        pickStatus,
        starRating,
      });
      return {
        photo_id: raw.photo_id ?? photoId,
        pick_status: (raw.pick_status ?? pickStatus) as PickStatus,
        star_rating: raw.star_rating ?? starRating,
        is_confirmed: raw.is_confirmed ?? true,
        updated_at: raw.updated_at ?? Date.now(),
      };
    } catch (err) {
      console.error('[TauriAPI] updateUserRating error:', err);
      return {
        photo_id: photoId,
        pick_status: pickStatus,
        star_rating: starRating,
        is_confirmed: true,
        updated_at: Date.now(),
      };
    }
  },

  getHistogram: async (imagePath: string, photoId?: string) => {
    return await invoke<{ red: number[]; green: number[]; blue: number[]; luma: number[] }>(
      'get_histogram',
      {
        imagePath,
        photoId,
      }
    );
  },

  getActiveModel: async () => {
    const raw = await invoke<MLModelOption>('get_active_model');
    return {
      id: raw.id,
      name: raw.name,
      providerType: raw.providerType,
      description: raw.description,
      embeddingDim: raw.embeddingDim,
      requiresApiKey: raw.requiresApiKey,
      isOfflineCapable: raw.isOfflineCapable,
    };
  },

  setActiveModel: async (modelId: string) => {
    const raw = await invoke<MLModelOption>('set_active_model', { modelId });
    return {
      id: raw.id,
      name: raw.name,
      providerType: raw.providerType,
      description: raw.description,
      embeddingDim: raw.embeddingDim,
      requiresApiKey: raw.requiresApiKey,
      isOfflineCapable: raw.isOfflineCapable,
    };
  },

  retrainAI: async () => {
    const res = await invoke<{ log: AccuracyLog; snapshot_id?: string; snapshotId?: string }>(
      'retrain_ai'
    );
    return {
      log: res.log,
      snapshotId: res.snapshotId || res.snapshot_id || '',
    };
  },

  getAccuracyLogs: async () => {
    return await invoke<AccuracyLog[]>('get_accuracy_logs');
  },

  exportRawTherapee: async (photoPath: string, rating: number, pickStatus: PickStatus) => {
    return await invoke<string>('export_rawtherapee', { photoPath, rating, pickStatus });
  },

  clearDatabase: async () => {
    return await invoke<boolean>('clear_database');
  },

  onImportProgress: (callback: (data: ImportProgressData) => void) => {
    let unlistenFn: UnlistenFn | null = null;
    listen<{
      folder_id?: string;
      folderId?: string;
      current: number;
      total: number;
      photo?: BackendCombinedPhotoData;
      photos?: BackendCombinedPhotoData[];
    }>('import-progress', event => {
      const payload = event.payload;
      const normalizedPayload: ImportProgressData = {
        folderId: payload.folderId || payload.folder_id || '',
        current: payload.current,
        total: payload.total,
        photo: payload.photo ? normalizeCombinedPhoto(payload.photo) : undefined,
        photos: payload.photos ? payload.photos.map(normalizeCombinedPhoto) : undefined,
      };
      callback(normalizedPayload);
    }).then(fn => {
      unlistenFn = fn;
    });
    return () => {
      if (unlistenFn) unlistenFn();
    };
  },

  onImportComplete: (callback: (data: { folderId: string; total: number }) => void) => {
    let unlistenFn: UnlistenFn | null = null;
    listen<{ folder_id?: string; folderId?: string; total: number }>('import-complete', event => {
      const payload = event.payload;
      callback({
        folderId: payload.folderId || payload.folder_id || '',
        total: payload.total,
      });
    }).then(fn => {
      unlistenFn = fn;
    });
    return () => {
      if (unlistenFn) unlistenFn();
    };
  },
};

// Initialize window.api with tauriApi for global accessibility
if (typeof window !== 'undefined') {
  window.api = tauriApi;
}
