/** Хөдөлгүүрүүдийн хуваалцах тогтмолууд ба үр дүнгийн нэгдсэн бүтэц. */

export const ENGINE = {
  TESSERACT: 'tesseract',
  CLAUDE: 'claude',
};

export const ENGINE_OPTIONS = [
  {
    value: ENGINE.TESSERACT,
    label: 'Tesseract (офлайн)',
    hint: 'Үнэгүй, браузерт ажиллана. Цэвэр скан дээр сайн.',
  },
  {
    value: ENGINE.CLAUDE,
    label: 'AI (Claude)',
    hint: 'Гэрэл зураг, гар бичмэл, холимог текст дээр эрс сайн. Сервер шаардана.',
  },
];

export const LANGUAGE_OPTIONS = [
  { value: 'mon+eng', label: 'Монгол + Англи', langs: ['mon', 'eng'] },
  { value: 'mon', label: 'Монгол', langs: ['mon'] },
  { value: 'eng', label: 'Англи', langs: ['eng'] },
];

/**
 * tessdata-гийн хувилбарууд. `4.0.0` (стандарт) нь `eng`-д 10.4MB legacy
 * загвар агуулдаг — tesseract.js v5 нь LSTM-only (oem=1) тул ашиглагдахгүй.
 * Тиймээс `_fast` / `_best` хоёрыг л ашиглана.
 */
export const QUALITY_OPTIONS = [
  {
    value: 'fast',
    label: 'Хурдан',
    hint: 'mon 1.3 MB + eng 1.9 MB',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
  },
  {
    value: 'best',
    label: 'Нарийвчлалтай',
    hint: 'mon 7.3 MB + eng 12.2 MB — монгол кирилл дээр мэдэгдэхүйц дээр',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
  },
];

/** Tesseract-ын хуудас задлах горим (`tessedit_pageseg_mode`). */
export const PSM_OPTIONS = [
  { value: '3', label: 'Автомат (баримт)' },
  { value: '6', label: 'Нэг блок' },
  { value: '7', label: 'Нэг мөр' },
  { value: '11', label: 'Тархай текст' },
];

/** Үүнээс доош итгэлцүүртэй мөрийг UI дээр тэмдэглэнэ. */
export const LOW_CONFIDENCE = 75;

export function findLanguage(value) {
  return LANGUAGE_OPTIONS.find((l) => l.value === value) || LANGUAGE_OPTIONS[0];
}

export function findQuality(value) {
  return QUALITY_OPTIONS.find((q) => q.value === value) || QUALITY_OPTIONS[0];
}

/**
 * Хоёр хөдөлгүүрийн үр дүнг нэг хэлбэрт оруулна.
 *
 * @typedef {object} OcrResult
 * @property {string} text Цэвэрлэсэн текст
 * @property {string} rawText Хөдөлгүүрийн түүхий гаралт
 * @property {{text: string, confidence: number|null}[]} lines
 * @property {number|null} meanConfidence 0..100
 * @property {string} engine
 * @property {number} durationMs
 */
export function makeResult({ text, rawText, lines, meanConfidence, engine, durationMs }) {
  return {
    text,
    rawText,
    lines: lines || [],
    meanConfidence: meanConfidence ?? null,
    engine,
    durationMs,
  };
}
