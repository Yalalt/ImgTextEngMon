import { makeResult, ENGINE } from './engines.js';
import { cleanLines, linesToText, detectDominantScript } from './postprocess.js';

/**
 * Статик hosting дээр (GitHub Pages гэх мэт) proxy өөр домэйнд байвал
 * `REACT_APP_OCR_API_URL`-ээр заана. Ердийн үед ижил гарал дээрх `/api/ocr`.
 */
const ENDPOINT = process.env.REACT_APP_OCR_API_URL || '/api/ocr';

/** Загвар мөрийг "эргэлзээтэй" гэж тэмдэглэсэн бол UI-д анхааруулах түвшин. */
const CONFIDENT = 95;
const UNCERTAIN = 45;

class OcrRequestError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = 'OcrRequestError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Бэлдсэн зургийг proxy руу илгээж таниулна.
 *
 * @param {{base64: string, mediaType: string}} image `preprocess.forVlm()`-ийн гаралт
 * @param {{signal?: AbortSignal, onProgress?: Function, useDominant?: boolean}} options
 * @returns {Promise<import('./engines.js').OcrResult>}
 */
export async function runClaudeOcr(image, options = {}) {
  const { signal, onProgress, useDominant = true } = options;
  const startedAt = Date.now();

  onProgress?.({ label: 'Зургийг AI руу илгээж байна', progress: null });

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: image.base64, mediaType: image.mediaType }),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new OcrRequestError(
      'API сервер рүү холбогдож чадсангүй. `npm run api` ажиллаж байгаа эсэхийг шалгана уу.',
      { code: 'NETWORK' },
    );
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new OcrRequestError(
      payload.error || `AI хөдөлгүүр алдаа буцаалаа (HTTP ${response.status}).`,
      { code: payload.code, status: response.status },
    );
  }

  onProgress?.({ label: 'Хариуг боловсруулж байна', progress: 0.95 });

  const rawText = payload.text || '';
  const dominant = detectDominantScript(rawText);

  const modelLines = Array.isArray(payload.lines) ? payload.lines : [];
  const rawLines = (modelLines.length
    ? modelLines
    : rawText.split('\n').map((line) => ({ text: line, uncertain: false }))
  ).map((line) => ({
    text: line.text || '',
    // Загвар нь мөр бүрд итгэлцүүр өгдөггүй — "эргэлзээтэй" тугийг л
    // UI-ийн нэгдсэн итгэлцүүрийн хэмжүүрт буулгана.
    confidence: line.text?.trim() ? (line.uncertain ? UNCERTAIN : CONFIDENT) : null,
  }));

  // Загвар нь скриптийг өөрөө зөв гаргах ёстой ч, хоёр хөдөлгүүрийн гаралтыг
  // ижил дүрмээр дамжуулснаар зан төлөв нь урьдчилан таамаглах боломжтой болно.
  const lines = cleanLines(rawLines, { useDominant, dominant });

  const scored = lines.filter((l) => typeof l.confidence === 'number');
  const meanConfidence = scored.length
    ? scored.reduce((sum, l) => sum + l.confidence, 0) / scored.length
    : null;

  return makeResult({
    engine: ENGINE.CLAUDE,
    rawText,
    text: linesToText(lines),
    lines,
    meanConfidence,
    durationMs: payload.durationMs ?? Date.now() - startedAt,
  });
}

export { OcrRequestError };
