import { createWorker } from 'tesseract.js';

import { makeResult, ENGINE } from './engines.js';
import { cleanLines, linesToText, detectDominantScript } from './postprocess.js';

/**
 * ЧУХАЛ: эдгээр CDN хаягууд `package.json` доторх `tesseract.js`-ийн
 * ЯГ ТЭР хувилбартай таарч байх ёстой (тиймээс тэнд `^` тэмдэггүй, яг 5.1.1
 * гэж бэхэлсэн). Worker болон core нь номын сангийн хувилбартай нийцэхгүй бол
 * ажиллах үедээ ойлгомжгүй алдаа өгнө.
 */
const WORKER_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js';
const CORE_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1';

/** LSTM-only. Legacy (0) горим tessdata_fast/_best-д дэмжигдэхгүй. */
const OEM_LSTM_ONLY = 1;

const STATUS_LABELS = {
  'loading tesseract core': 'Хөдөлгүүр ачаалж байна',
  'initializing tesseract': 'Хөдөлгүүр бэлдэж байна',
  'loading language traineddata': 'Хэлний загвар татаж байна',
  'initializing api': 'Бэлтгэж байна',
  'recognizing text': 'Текст таньж байна',
};

function labelFor(status) {
  return STATUS_LABELS[status] || 'Боловсруулж байна';
}

/**
 * `blocks` модноос мөр бүрийн итгэлцүүрийг УНШИХ дарааллаар гаргана.
 * Зарим PSM горимд `blocks` нь `null` байдаг.
 */
function extractConfidences(data) {
  const confidences = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        if (!(line.text || '').trim()) continue;
        confidences.push(typeof line.confidence === 'number' ? line.confidence : null);
      }
    }
  }
  return confidences;
}

/**
 * Мөрийн жагсаалтыг угсарна.
 *
 * Догол мөрийн заагийг `blocks` модноос БИШ, Tesseract-ын өөрийн `data.text`-ээс
 * авна: тэнд догол мөр хоорондоо хоосон мөрөөр зөв тусгаарлагдсан байдаг. Модны
 * `paragraph` бүрийг зааг гэж үзвэл Tesseract нэг мөрийг нэг догол мөр болгосон
 * тохиолдолд мөр бүрийн хооронд хуурамч хоосон мөр үүсэж, улмаар мөр дамнасан
 * зураасны нийлүүлэлт хийгдэхгүй болно.
 *
 * Итгэлцүүрийг хоосон биш мөрүүдтэй нь дарааллаар нь тааруулна; тоо таарахгүй
 * бол буруу мөрийг тэмдэглэхээс аюулгүй тал руу нь — итгэлцүүргүй үлдээнэ.
 */
function buildLines(rawText, data) {
  const textLines = rawText.split('\n');
  const confidences = extractConfidences(data);
  const nonEmptyCount = textLines.filter((line) => line.trim()).length;
  const aligned = confidences.length === nonEmptyCount;

  let index = 0;
  return textLines.map((text) => {
    if (!text.trim()) return { text: '', confidence: null };
    const confidence = aligned ? confidences[index] : null;
    index += 1;
    return { text, confidence };
  });
}

/**
 * Нэг worker-ийг дахин ашигладаг Tesseract хөдөлгүүр.
 *
 * Өмнөх хэрэгжүүлэлт нь дуудалт бүрд шинэ worker үүсгээд заримыг нь terminate
 * хийхгүй орхиж байсан — энэ нь хэлний загварыг дахин дахин татахад хүргэдэг.
 * Энд worker-ийг хадгалж, хэл солигдвол `reinitialize`, langPath солигдвол л
 * дахин үүсгэнэ.
 */
export function createTesseractEngine() {
  let worker = null;
  let activeLangKey = null;
  let activeLangPath = null;
  /** Одоо ажиллаж буй дуудалтын progress callback (logger нь worker-т бэхлэгддэг). */
  let activeOnProgress = null;
  /** Дуудалтуудыг дараалуулах — reinitialize нь ажиллаж буй job-той зөрчилдөж болно. */
  let queue = Promise.resolve();

  function handleLog(message) {
    if (!activeOnProgress) return;
    activeOnProgress({
      label: labelFor(message.status),
      status: message.status,
      progress: typeof message.progress === 'number' ? message.progress : null,
    });
  }

  async function ensureWorker(langs, langPath) {
    const langKey = langs.join('+');

    // `langPath` нь createWorker-ийн сонголт — reinitialize-ээр солигдохгүй.
    if (worker && activeLangPath !== langPath) {
      await worker.terminate();
      worker = null;
      activeLangKey = null;
    }

    if (!worker) {
      worker = await createWorker(langs, OEM_LSTM_ONLY, {
        workerPath: WORKER_PATH,
        corePath: CORE_PATH,
        langPath,
        logger: handleLog,
      });
      activeLangPath = langPath;
      activeLangKey = langKey;
    } else if (activeLangKey !== langKey) {
      await worker.reinitialize(langs, OEM_LSTM_ONLY);
      activeLangKey = langKey;
    }

    return worker;
  }

  async function runOnce(image, options) {
    const { langs, langPath, psm, useDominant, onProgress } = options;
    const startedAt = Date.now();
    activeOnProgress = onProgress;

    try {
      const activeWorker = await ensureWorker(langs, langPath);

      await activeWorker.setParameters({
        tessedit_pageseg_mode: String(psm),
        // Үг хоорондын зайг хадгална — баганат бичвэрийн бүтэц алдагдахгүй.
        preserve_interword_spaces: '1',
        // "Invalid resolution 0 dpi" анхааруулгыг арилгаж, дотоод масштаблалтыг
        // тогтворжуулна. Бид зургаа ~300 DPI-д тохируулж өгсөн.
        user_defined_dpi: '300',
        // tessedit_char_whitelist ЗОРИУДААР тавиагүй — холимог кирилл/латин
        // charset-ыг хязгаарлавал нэг скрипт бүхэлдээ алдагдана.
      });

      const { data } = await activeWorker.recognize(image, {}, { text: true, blocks: true });

      const rawText = data.text || '';
      const dominant = detectDominantScript(rawText);

      // Мөрүүдийг цэвэрлээд ЭНДЭЭС л эцсийн текстийг угсарна — ингэснээр
      // дэлгэц дээр харагдах болон хуулагдах текст ялгаагүй болно.
      const lines = cleanLines(buildLines(rawText, data), { useDominant, dominant });

      const scored = lines.filter((l) => typeof l.confidence === 'number');
      const meanConfidence = scored.length
        ? scored.reduce((sum, l) => sum + l.confidence, 0) / scored.length
        : typeof data.confidence === 'number'
          ? data.confidence
          : null;

      return makeResult({
        engine: ENGINE.TESSERACT,
        rawText,
        text: linesToText(lines),
        lines,
        meanConfidence,
        durationMs: Date.now() - startedAt,
      });
    } finally {
      activeOnProgress = null;
    }
  }

  return {
    /**
     * @param {HTMLCanvasElement|Blob|string} image
     * @param {{langs: string[], langPath: string, psm: string,
     *          useDominant: boolean, onProgress: (p: object) => void}} options
     * @returns {Promise<import('./engines.js').OcrResult>}
     */
    run(image, options) {
      const next = queue.then(
        () => runOnce(image, options),
        () => runOnce(image, options),
      );
      // Дараалал нь дараагийн дуудалтыг блоклохоос өөр үүрэггүй тул
      // алдааг энд залгиж, дуудагч талд `next`-ээр буцаана.
      queue = next.catch(() => {});
      return next;
    },

    async dispose() {
      const current = worker;
      worker = null;
      activeLangKey = null;
      activeLangPath = null;
      if (current) await current.terminate();
    },
  };
}
