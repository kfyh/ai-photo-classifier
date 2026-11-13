import { useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { CombinedPhotoData } from '../types';

const MAX_CACHE_ENTRIES = 1000;
const MAX_SIZED_CACHE_ENTRIES = 500;
const MAX_RETRY_ATTEMPTS = 2;
const MAX_CONCURRENT_BATCHES = 2;
const MAX_SIZED_CONCURRENT_BATCHES = 1;
const BATCH_DEBOUNCE_MS = 25;
const SIZED_BATCH_DEBOUNCE_MS = 80;
const thumbDataUrlCache = new Map<string, string>();
const sizedThumbCache = new Map<string, { slotPx: number; dataUrl: string }>();
const inFlightPhotoIds = new Set<string>();
const inFlightSizedKeys = new Set<string>();
const failedAttempts = new Map<string, number>();
const failedSizedAttempts = new Map<string, number>();
const subscribers = new Set<() => void>();
let activeBatchCount = 0;
let activeSizedBatchCount = 0;

function preloadDecodedImage(dataUrl: string): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  return new Promise(resolve => {
    const img = new Image();
    img.src = dataUrl;
    if (typeof img.decode === 'function') {
      img.decode().then(() => resolve(), () => resolve());
    } else {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    }
  });
}

function setCachedThumb(key: string, dataUrl: string): void {
  if (!key || !dataUrl) return;
  if (thumbDataUrlCache.has(key)) {
    thumbDataUrlCache.delete(key);
  } else if (thumbDataUrlCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = thumbDataUrlCache.keys().next().value;
    if (oldestKey !== undefined) {
      thumbDataUrlCache.delete(oldestKey);
    }
  }
  thumbDataUrlCache.set(key, dataUrl);
}

function setCachedSizedThumb(photoId: string, slotPx: number, dataUrl: string): void {
  if (!photoId || !dataUrl) return;
  const existing = sizedThumbCache.get(photoId);
  if (existing && existing.slotPx > slotPx) {
    return;
  }
  if (sizedThumbCache.has(photoId)) {
    sizedThumbCache.delete(photoId);
  } else if (sizedThumbCache.size >= MAX_SIZED_CACHE_ENTRIES) {
    const oldestKey = sizedThumbCache.keys().next().value;
    if (oldestKey !== undefined) {
      sizedThumbCache.delete(oldestKey);
    }
  }
  sizedThumbCache.set(photoId, { slotPx, dataUrl });
}

export function invalidateCachedThumb(photoId: string, filePath?: string): void {
  if (photoId) {
    thumbDataUrlCache.delete(photoId);
    sizedThumbCache.delete(photoId);
  }
  if (filePath) thumbDataUrlCache.delete(filePath);
}

function notifySubscribers(): void {
  for (const cb of subscribers) {
    cb();
  }
}

/**
 * Resolves local file paths to cached data URLs (via Tauri IPC) or Webview asset URLs.
 * When `desiredSlotPx` is provided, prefers a slot-matched progressive thumbnail if available,
 * falling back to the fast embedded thumbnail while the higher-resolution thumbnail loads.
 */
export function getPhotoSrc(
  path: string | null | undefined,
  photoId?: string,
  desiredSlotPx?: number
): string {
  if (desiredSlotPx && photoId) {
    const sized = sizedThumbCache.get(photoId);
    if (sized && sized.slotPx >= desiredSlotPx) {
      return sized.dataUrl;
    }
  }
  if (photoId && thumbDataUrlCache.has(photoId)) {
    return thumbDataUrlCache.get(photoId)!;
  }
  if (path && thumbDataUrlCache.has(path)) {
    return thumbDataUrlCache.get(path)!;
  }
  if (!path) return '';
  if (
    path.startsWith('data:') ||
    path.startsWith('blob:') ||
    path.startsWith('http://') ||
    path.startsWith('https://')
  ) {
    return path;
  }
  if (typeof window !== 'undefined' && window.api?.getThumbnailsBatch) {
    return '';
  }
  return convertFileSrc(path);
}

/**
 * Returns the slot-matched progressive thumbnail data URL if cached at >= `desiredSlotPx`,
 * or null if not yet available.
 */
export function getSizedPhotoSrc(photoId: string, desiredSlotPx: number): string | null {
  if (!photoId || !desiredSlotPx) return null;
  const sized = sizedThumbCache.get(photoId);
  if (sized && sized.slotPx >= desiredSlotPx) {
    return sized.dataUrl;
  }
  return null;
}

/**
 * Resolves a photo's original file path to a full-resolution URL for Loupe View,
 * bypassing the 400px thumbnail cache.
 */
export function getFullImageSrc(path: string | null | undefined): string {
  if (!path) return '';
  if (
    path.startsWith('data:') ||
    path.startsWith('blob:') ||
    path.startsWith('http://') ||
    path.startsWith('https://')
  ) {
    return path;
  }
  return convertFileSrc(path);
}

/**
 * React hook that loads and caches `data:image/jpeg;base64,...` thumbnails via Tauri IPC
 * for the currently visible slice of photos without opening any network ports.
 */
export function useResolvedThumbnails(
  visiblePhotos: CombinedPhotoData[],
  targetSlotPx?: number
): number {
  const [version, setVersion] = useState(0);
  const latestPhotosRef = useRef<CombinedPhotoData[]>(visiblePhotos);
  const latestSlotPxRef = useRef<number | undefined>(targetSlotPx);
  const fastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sizedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  latestPhotosRef.current = visiblePhotos;
  latestSlotPxRef.current = targetSlotPx;

  useEffect(() => {
    const listener = () => setVersion(v => v + 1);
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
      if (fastTimerRef.current) {
        clearTimeout(fastTimerRef.current);
        fastTimerRef.current = null;
      }
      if (sizedTimerRef.current) {
        clearTimeout(sizedTimerRef.current);
        sizedTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const getThumbnailsBatch =
      typeof window !== 'undefined' ? window.api?.getThumbnailsBatch : undefined;
    if (!getThumbnailsBatch || visiblePhotos.length === 0) {
      return;
    }
    if (fastTimerRef.current || activeBatchCount >= MAX_CONCURRENT_BATCHES) {
      return;
    }

    fastTimerRef.current = setTimeout(() => {
      fastTimerRef.current = null;
      if (activeBatchCount >= MAX_CONCURRENT_BATCHES) return;

      const batchToFetch = latestPhotosRef.current
        .filter(item => {
          const p = item.photo;
          if (
            p.file_path.startsWith('data:') ||
            p.file_path.startsWith('blob:') ||
            p.file_path.startsWith('http://') ||
            p.file_path.startsWith('https://')
          ) {
            return false;
          }
          return (
            !thumbDataUrlCache.has(p.id) &&
            !inFlightPhotoIds.has(p.id) &&
            (failedAttempts.get(p.id) ?? 0) < MAX_RETRY_ATTEMPTS
          );
        })
        .slice(0, 24)
        .map(item => ({
          id: item.photo.id,
          filePath: item.photo.file_path,
        }));

      if (batchToFetch.length === 0) return;

      activeBatchCount += 1;
      for (const m of batchToFetch) {
        inFlightPhotoIds.add(m.id);
      }

      getThumbnailsBatch(batchToFetch)
        .then(result => {
          for (const m of batchToFetch) {
            inFlightPhotoIds.delete(m.id);
            const dataUrl = result[m.id];
            if (dataUrl) {
              failedAttempts.delete(m.id);
              setCachedThumb(m.id, dataUrl);
            } else {
              failedAttempts.set(m.id, (failedAttempts.get(m.id) ?? 0) + 1);
            }
          }
        })
        .catch(() => {
          for (const m of batchToFetch) {
            inFlightPhotoIds.delete(m.id);
            failedAttempts.set(m.id, (failedAttempts.get(m.id) ?? 0) + 1);
          }
        })
        .finally(() => {
          activeBatchCount = Math.max(0, activeBatchCount - 1);
          notifySubscribers();
        });
    }, BATCH_DEBOUNCE_MS);
  }, [visiblePhotos, version]);

  // Progressive Phase 2: upgrade slots to crisp slot-matched thumbnails without flicker
  useEffect(() => {
    const getSizedThumbnailsBatch =
      typeof window !== 'undefined' ? window.api?.getSizedThumbnailsBatch : undefined;
    if (!getSizedThumbnailsBatch || !targetSlotPx || targetSlotPx <= 0 || visiblePhotos.length === 0) {
      return;
    }
    if (sizedTimerRef.current || activeSizedBatchCount >= MAX_SIZED_CONCURRENT_BATCHES) {
      return;
    }

    sizedTimerRef.current = setTimeout(() => {
      sizedTimerRef.current = null;
      const slotPx = latestSlotPxRef.current;
      if (!slotPx || slotPx <= 0 || activeSizedBatchCount >= MAX_SIZED_CONCURRENT_BATCHES) return;

      const batchToFetch = latestPhotosRef.current
        .filter(item => {
          const p = item.photo;
          if (
            p.file_path.startsWith('data:') ||
            p.file_path.startsWith('blob:') ||
            p.file_path.startsWith('http://') ||
            p.file_path.startsWith('https://')
          ) {
            return false;
          }
          const cached = sizedThumbCache.get(p.id);
          if (cached && cached.slotPx >= slotPx) {
            return false;
          }
          const key = `${p.id}:${slotPx}`;
          return (
            !inFlightSizedKeys.has(key) &&
            (failedSizedAttempts.get(key) ?? 0) < MAX_RETRY_ATTEMPTS
          );
        })
        .slice(0, 12)
        .map(item => ({
          id: item.photo.id,
          filePath: item.photo.file_path,
        }));

      if (batchToFetch.length === 0) return;

      activeSizedBatchCount += 1;
      for (const m of batchToFetch) {
        inFlightSizedKeys.add(`${m.id}:${slotPx}`);
      }

      getSizedThumbnailsBatch(batchToFetch, slotPx)
        .then(async result => {
          const decodedEntries: { id: string; dataUrl: string }[] = [];
          await Promise.all(
            batchToFetch.map(async m => {
              const key = `${m.id}:${slotPx}`;
              inFlightSizedKeys.delete(key);
              const dataUrl = result[m.id];
              if (dataUrl) {
                await preloadDecodedImage(dataUrl);
                failedSizedAttempts.delete(key);
                decodedEntries.push({ id: m.id, dataUrl });
              } else {
                failedSizedAttempts.set(key, (failedSizedAttempts.get(key) ?? 0) + 1);
              }
            })
          );
          for (const entry of decodedEntries) {
            setCachedSizedThumb(entry.id, slotPx, entry.dataUrl);
          }
        })
        .catch(() => {
          for (const m of batchToFetch) {
            const key = `${m.id}:${slotPx}`;
            inFlightSizedKeys.delete(key);
            failedSizedAttempts.set(key, (failedSizedAttempts.get(key) ?? 0) + 1);
          }
        })
        .finally(() => {
          activeSizedBatchCount = Math.max(0, activeSizedBatchCount - 1);
          notifySubscribers();
        });
    }, SIZED_BATCH_DEBOUNCE_MS);
  }, [visiblePhotos, targetSlotPx, version]);

  return version;
}
