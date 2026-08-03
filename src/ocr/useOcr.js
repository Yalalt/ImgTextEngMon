import { useCallback, useEffect, useRef, useState } from 'react';

import { ENGINE, findLanguage, findQuality } from './engines.js';
import { createTesseractEngine } from './tesseractEngine.js';
import { runClaudeOcr } from './claudeEngine.js';
import { loadBitmap, forTesseract, forVlm } from './preprocess.js';

/**
 * OCR-ын бүх амьдралын мөчлөгийг эзэмших hook: хөдөлгүүр сонголт, явц,
 * алдаа, цуцлалт, хуучирсан үр дүнгээс хамгаалах.
 *
 * `App` нь зөвхөн UI-д төвлөрөх боломжтой болно.
 */
export function useOcr() {
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [progress, setProgress] = useState(null); // { label, progress }
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const tesseractRef = useRef(null);
  const abortRef = useRef(null);
  /** Зөвхөн ХАМГИЙН СҮҮЛИЙН хүсэлтийн үр дүнг хүлээн авна. */
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      // Worker-ийг заавал устгана — эс бөгөөс хэлний загвар санах ойд үлдэнэ.
      tesseractRef.current?.dispose();
      tesseractRef.current = null;
    };
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
    setProgress(null);
    setResult(null);
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
    setProgress(null);
  }, []);

  /**
   * @param {File|Blob} file
   * @param {{engine: string, language: string, quality: string, psm: string,
   *          binarize: boolean, useDominant: boolean}} settings
   */
  const run = useCallback(async (file, settings) => {
    if (!file) return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const isStale = () => requestIdRef.current !== requestId || !mountedRef.current;
    const onProgress = (next) => {
      if (!isStale()) setProgress(next);
    };

    setStatus('running');
    setError(null);
    setProgress({ label: 'Зураг бэлдэж байна', progress: null });

    try {
      const bitmap = await loadBitmap(file);
      if (isStale()) return;

      let ocrResult;
      if (settings.engine === ENGINE.CLAUDE) {
        const image = await forVlm(bitmap);
        if (isStale()) return;
        ocrResult = await runClaudeOcr(image, {
          signal: controller.signal,
          onProgress,
          useDominant: settings.useDominant,
        });
      } else {
        const canvas = forTesseract(bitmap, { binarize: settings.binarize });
        if (isStale()) return;

        if (!tesseractRef.current) tesseractRef.current = createTesseractEngine();
        const { langs } = findLanguage(settings.language);
        const { langPath } = findQuality(settings.quality);

        ocrResult = await tesseractRef.current.run(canvas, {
          langs,
          langPath,
          psm: settings.psm,
          useDominant: settings.useDominant,
          onProgress,
        });
      }

      if (isStale()) return;
      setResult(ocrResult);
      setProgress(null);
      setStatus('done');
    } catch (caught) {
      if (caught?.name === 'AbortError' || isStale()) return;
      setError(caught?.message || 'Тодорхойгүй алдаа гарлаа.');
      setProgress(null);
      setStatus('error');
    }
  }, []);

  return { status, progress, result, error, run, cancel, reset };
}
