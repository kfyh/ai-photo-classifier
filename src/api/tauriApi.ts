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
} from '../types';

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
  exportRawTherapee: (
    photoPath: string,
    rating: number,
    pickStatus: PickStatus
  ) => Promise<string>;
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
        photoCount: f.photoCount ?? (f as any).photo_count,
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
      const raw = await invoke<any[]>('get_photos_in_folder', { folderId });
      return raw.map(item => ({
        photo: {
          id: item.photo.id,
          folder_id: item.photo.folder_id,
          file_path: item.photo.file_path,
          file_name: item.photo.file_name,
          file_size: item.photo.file_size,
          width: item.photo.width,
          height: item.photo.height,
          date_taken: item.photo.date_taken,
          created_at: item.photo.created_at,
          thumbnail_path: item.photo.thumbnail_path,
        },
        exif: item.exif ? {
          photo_id: item.exif.photo_id,
          camera_make: item.exif.camera_make,
          camera_model: item.exif.camera_model,
          lens_model: item.exif.lens_model,
          iso: item.exif.iso,
          aperture: item.exif.aperture,
          shutter_speed: item.exif.shutter_speed,
          focal_length: item.exif.focal_length,
          exposure_bias: item.exif.exposure_bias,
        } : undefined,
        userRating: {
          photo_id: item.userRating?.photo_id || item.user_rating?.photo_id || item.photo.id,
          pick_status: item.userRating?.pick_status || item.user_rating?.pick_status || 'unflagged',
          star_rating: item.userRating?.star_rating ?? item.user_rating?.star_rating ?? 0,
          is_confirmed: item.userRating?.is_confirmed ?? item.user_rating?.is_confirmed ?? false,
          updated_at: item.userRating?.updated_at || item.user_rating?.updated_at || Date.now(),
        },
        quality: item.quality ? {
          photo_id: item.quality.photo_id,
          blur_score: item.quality.blur_score,
          is_black_frame: item.quality.is_black_frame,
          is_overexposed: item.quality.is_overexposed,
          mean_luminance: item.quality.mean_luminance,
        } : undefined,
        aiPrediction: (item.aiPrediction || item.ai_prediction) ? {
          photo_id: (item.aiPrediction || item.ai_prediction).photo_id,
          provider_type: (item.aiPrediction || item.ai_prediction).provider_type,
          model_name: (item.aiPrediction || item.ai_prediction).model_name,
          predicted_pick: (item.aiPrediction || item.ai_prediction).predicted_pick,
          predicted_rating: (item.aiPrediction || item.ai_prediction).predicted_rating,
          pick_confidence: (item.aiPrediction || item.ai_prediction).pick_confidence,
          rating_confidence: (item.aiPrediction || item.ai_prediction).rating_confidence,
          model_snapshot_id: (item.aiPrediction || item.ai_prediction).model_snapshot_id,
          updated_at: (item.aiPrediction || item.ai_prediction).updated_at,
        } : undefined,
      }));
    } catch (err) {
      console.error('[TauriAPI] getPhotosInFolder error:', err);
      return [];
    }
  },

  updateUserRating: async (photoId: string, pickStatus: PickStatus, starRating: number) => {
    const raw = await invoke<any>('update_user_rating', { photoId, pickStatus, starRating });
    return {
      photo_id: raw.photo_id,
      pick_status: raw.pick_status,
      star_rating: raw.star_rating,
      is_confirmed: raw.is_confirmed,
      updated_at: raw.updated_at,
    };
  },

  getHistogram: async (imagePath: string, photoId?: string) => {
    return await invoke<{ red: number[]; green: number[]; blue: number[]; luma: number[] }>('get_histogram', {
      imagePath,
      photoId,
    });
  },

  getActiveModel: async () => {
    const raw = await invoke<any>('get_active_model');
    return {
      id: raw.id,
      name: raw.name,
      providerType: raw.providerType || raw.provider_type,
      description: raw.description,
      embeddingDim: raw.embeddingDim || raw.embedding_dim,
      requiresApiKey: raw.requiresApiKey ?? raw.requires_api_key,
      isOfflineCapable: raw.isOfflineCapable ?? raw.is_offline_capable,
    };
  },

  setActiveModel: async (modelId: string) => {
    const raw = await invoke<any>('set_active_model', { modelId });
    return {
      id: raw.id,
      name: raw.name,
      providerType: raw.providerType || raw.provider_type,
      description: raw.description,
      embeddingDim: raw.embeddingDim || raw.embedding_dim,
      requiresApiKey: raw.requiresApiKey ?? raw.requires_api_key,
      isOfflineCapable: raw.isOfflineCapable ?? raw.is_offline_capable,
    };
  },

  retrainAI: async () => {
    const res = await invoke<any>('retrain_ai');
    return {
      log: res.log,
      snapshotId: res.snapshotId || res.snapshot_id,
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
    listen<ImportProgressData>('import-progress', event => {
      callback(event.payload);
    }).then(fn => {
      unlistenFn = fn;
    });
    return () => {
      if (unlistenFn) unlistenFn();
    };
  },

  onImportComplete: (callback: (data: { folderId: string; total: number }) => void) => {
    let unlistenFn: UnlistenFn | null = null;
    listen<{ folderId: string; total: number }>('import-complete', event => {
      callback(event.payload);
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
  (window as any).api = tauriApi;
}
