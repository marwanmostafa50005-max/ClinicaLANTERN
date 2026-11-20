// How much of a PDF page is covered by pictures. Used to tell a scanned page from a page of text.
// Pure code with no browser or PDF library in it, so it can be tested on its own.
//
// Why this is needed: a scanned page often carries a little real text as well: a fax header, a
// scanner stamp, or a thin layer of text from text recognition. Until 18 November a page with 40
// letters or more was taken as a page of text, the picture was never looked at, and every supply
// in the scan was lost without a word.

/** The numbers pdf.js gives to the drawing steps that matter here (pdfjs.OPS). */
export interface PictureOps {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageMaskXObject: number;
  paintSolidColorImageMask?: number;
  paintImageXObjectRepeat?: number;
  paintInlineImageXObjectGroup?: number;
  paintImageMaskXObjectGroup?: number;
  paintImageMaskXObjectRepeat?: number;
}

/** A page is treated as a scan when pictures cover at least this share of it. A logo covers far less. */
export const SCAN_PICTURE_SHARE = 0.2;

function scaleOf(matrix: unknown): number {
  if (!Array.isArray(matrix) && !ArrayBuffer.isView(matrix)) return 1;
  const m = matrix as ArrayLike<number>;
  if (m.length < 4) return 1;
  const det = Math.abs(Number(m[0]) * Number(m[3]) - Number(m[1]) * Number(m[2]));
  return Number.isFinite(det) ? det : 1;
}

/**
 * The share of the page that pictures cover: 0 for none, about 1 for a full-page scan.
 * Pictures that overlap are counted twice, which only errs on the safe side.
 * A picture whose size cannot be told counts as the whole page: when in doubt, the page is a scan.
 */
export function pictureShare(
  fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>, ops: PictureOps, pageWidth: number, pageHeight: number,
): number {
  const pageArea = Math.abs(pageWidth * pageHeight);
  if (!(pageArea > 0)) return 0;
  const sized = new Set([ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageMaskXObject, ops.paintSolidColorImageMask]);
  const unsized = new Set([
    ops.paintImageXObjectRepeat, ops.paintInlineImageXObjectGroup, ops.paintImageMaskXObjectGroup, ops.paintImageMaskXObjectRepeat,
  ]);
  sized.delete(undefined);
  unsized.delete(undefined);

  // A picture is drawn into a square of one unit, stretched by the transforms in force. Its area on
  // the page is the product of the scale of those transforms, so only that scale is kept.
  let scale = 1;
  const saved: number[] = [];
  let covered = 0;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === ops.save) {
      saved.push(scale);
    } else if (fn === ops.restore) {
      scale = saved.pop() ?? 1;
    } else if (fn === ops.transform) {
      scale *= scaleOf(args);
    } else if (fn === ops.paintFormXObjectBegin) {
      saved.push(scale);
      scale *= scaleOf(Array.isArray(args) ? args[0] : undefined);
    } else if (fn === ops.paintFormXObjectEnd) {
      scale = saved.pop() ?? 1;
    } else if (unsized.has(fn)) {
      return Number.POSITIVE_INFINITY;
    } else if (sized.has(fn)) {
      covered += scale;
    }
  }
  return covered / pageArea;
}

/**
 * Decides what one page of a PDF is.
 * letters: how many letters of real text the page holds. share: how much of it pictures cover.
 * "scan": the page is sent as a picture for Model 1 to read, and the pharmacist checks the rows.
 * "text": the printed rows are read from the text. "unknown": neither text nor a picture was found.
 */
export function pageKind(letters: number, share: number, minTextLetters: number): 'text' | 'scan' | 'unknown' {
  // Pictures cover a good part of the page: it is a scan, however much text lies over it.
  if (share >= SCAN_PICTURE_SHARE) return 'scan';
  if (letters >= minTextLetters) return 'text';
  // Hardly any text. With any picture at all the page is a scan with a stamp on it.
  if (share > 0) return 'scan';
  return letters > 0 ? 'text' : 'unknown';
}
