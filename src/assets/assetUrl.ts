/**
 * GitHub Pages may cache public-directory files independently of each HTML
 * deployment. Bump this token whenever a Pages deployment replaces LFS media,
 * so a browser cannot keep rendering an old Git LFS pointer as an image/audio
 * response.
 */
const PUBLIC_ASSET_REVISION = "20260722-lion-and-unlocks-3";

export function assetUrl(path: string): string {
  return `${path}?v=${PUBLIC_ASSET_REVISION}`;
}
