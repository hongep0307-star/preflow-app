/**
 * contactSheet — client-side splitter for the 3x3 contact sheet produced
 * by NB2 in Camera Variations → Contact Sheet tab.
 *
 * Why client-side:
 *   Electron's main process has no DOM canvas and we didn't want to take
 *   a 50MB `sharp` dep just to slice a PNG. Doing it in the renderer
 *   keeps the electron bundle lean and gets us a free, fast split using
 *   the browser's built-in Canvas API.
 *
 * splitContactSheetDataUrl(url)
 *   Fetches a contact-sheet image, draws it into a canvas, then crops
 *   each of 9 (3x3) tiles with a small inner bleed to avoid picking up
 *   NB2's white gutter pixels. Returns 9 PNG data-URLs in
 *   left-to-right / top-to-bottom order matching CONTACT_SHEET_IDS.
 *
 *   The optional `bleedPx` argument lets callers tune the inset per
 *   output image — NB2 varies the gutter thickness run-to-run, so
 *   the default (~1% of tile width) is a safe general-purpose value.
 *
 * dataUrlToBlob(dataUrl)
 *   Converts a data URL back to a Blob so it can be uploaded via the
 *   local-server storage:save-image endpoint.
 */

const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 3;

export interface SplitOptions {
  rows?: number;
  cols?: number;
  /** Inset each tile by this many pixels on every side before cropping.
   *  Default = 1% of the tile width, clamped to [2, 16] px. */
  bleedPx?: number;
}

/** Load an <img> and wait for it to fully decode. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Contact-sheet URLs live on our own electron local-file adapter so
    // crossOrigin is irrelevant, but set anyway for belt-and-braces if a
    // future build shifts to http Supabase storage.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load contact-sheet image: ${url}`));
    img.src = url;
  });
}

/**
 * Split a contact-sheet image URL into rows*cols data URLs.
 * Throws on decode / canvas failure; callers should surface the error
 * to the user via their existing toast/error UI.
 */
export async function splitContactSheetDataUrl(
  url: string,
  opts: SplitOptions = {},
): Promise<string[]> {
  const rows = opts.rows ?? DEFAULT_ROWS;
  const cols = opts.cols ?? DEFAULT_COLS;

  const img = await loadImage(url);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  if (!W || !H) throw new Error("Contact-sheet image has zero dimensions");

  const tileW = Math.floor(W / cols);
  const tileH = Math.floor(H / rows);
  if (tileW < 16 || tileH < 16) {
    throw new Error(`Contact-sheet too small to split (${W}x${H}).`);
  }

  // Clamp the bleed to something sane so we never accidentally inset
  // past the centre of a tile.
  const autoBleed = Math.max(2, Math.min(16, Math.round(tileW * 0.01)));
  const bleed = Math.max(0, Math.min(Math.floor(tileW / 4), opts.bleedPx ?? autoBleed));

  const tiles: string[] = [];
  const canvas = document.createElement("canvas");
  canvas.width = tileW - bleed * 2;
  canvas.height = tileH - bleed * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to allocate 2D canvas context for contact-sheet split");

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = c * tileW + bleed;
      const sy = r * tileH + bleed;
      const sw = tileW - bleed * 2;
      const sh = tileH - bleed * 2;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      tiles.push(canvas.toDataURL("image/png"));
    }
  }

  return tiles;
}

/** Convert a data URL to a Blob (for uploading the chosen tile to storage). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const m = /data:([^;]+)(;base64)?/.exec(head);
  if (!m) throw new Error("Invalid data URL");
  const mime = m[1];
  const isB64 = head.includes(";base64");
  if (isB64) {
    const bin = atob(body);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}

/** Extract just the base64 body of a `data:...;base64,...` URL. */
export function dataUrlToBase64(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  if (idx < 0) throw new Error("Invalid data URL");
  return dataUrl.slice(idx + 1);
}
