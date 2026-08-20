import {
  CombinedPhotoData,
  FolderRecord,
  UserRating,
  AccuracyLog,
  MLModelOption,
  PickStatus,
  ImportProgressData,
} from './index';

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

declare global {
  interface Window {
    api?: TauriAPI;
  }
}
