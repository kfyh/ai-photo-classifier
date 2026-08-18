import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * Resolves local file paths to Webview asset protocol URLs in Tauri v2
 */
export function getPhotoSrc(path: string | null | undefined): string {
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
