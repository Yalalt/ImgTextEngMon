import { useCallback, useEffect, useState } from 'react';

import { LOW_CONFIDENCE } from '../ocr/engines.js';

function formatConfidence(value) {
  return value === null ? '—' : `${Math.round(value)}%`;
}

function useCopyFeedback() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, []);

  return { copied, copy };
}

function download(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Танисан текстийг харуулна.
 *
 * "Түүхий" харагдац нь ЗОРИУДААР байгаа — цэвэрлэгээ юу өөрчилснийг хэрэглэгч
 * шалгах боломжтой байх ёстой (кирилл/латин нэгтгэлт нүдээр харагддаггүй).
 */
export default function ResultPanel({ result, baseName }) {
  const [view, setView] = useState('clean');
  const { copied, copy } = useCopyFeedback();

  if (!result) return null;

  const text = view === 'clean' ? result.text : result.rawText;
  const changed = result.text !== result.rawText;

  return (
    <section className="result">
      <header className="result__header">
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'clean'}
            className={`tab${view === 'clean' ? ' tab--active' : ''}`}
            onClick={() => setView('clean')}
          >
            Цэвэрлэсэн
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'raw'}
            className={`tab${view === 'raw' ? ' tab--active' : ''}`}
            onClick={() => setView('raw')}
          >
            Түүхий
            {changed ? <span className="tab__dot" title="Цэвэрлэгээ өөрчлөлт хийсэн" /> : null}
          </button>
        </div>

        <div className="result__actions">
          <span className="badge" title="Дундаж итгэлцүүр">
            Итгэлцүүр {formatConfidence(result.meanConfidence)}
          </span>
          <span className="badge badge--muted">{(result.durationMs / 1000).toFixed(1)} сек</span>
          <button type="button" className="button" onClick={() => copy(text)}>
            {copied ? 'Хуулагдлаа ✓' : 'Хуулах'}
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => download(text, `${baseName || 'text'}.txt`)}
          >
            .txt татах
          </button>
        </div>
      </header>

      {view === 'clean' ? (
        <div className="result__lines">
          {result.lines.length === 0 ? (
            <p className="result__empty">Текст олдсонгүй.</p>
          ) : (
            result.lines.map((line, index) => {
              const low =
                typeof line.confidence === 'number' && line.confidence < LOW_CONFIDENCE;
              return (
                <p
                  // Мөрүүд нь зөвхөн дараалалаараа ялгагдана — тогтвортой id байхгүй.
                  // eslint-disable-next-line react/no-array-index-key
                  key={index}
                  className={`result__line${low ? ' result__line--low' : ''}`}
                  title={low ? `Итгэлцүүр ${formatConfidence(line.confidence)} — шалгана уу` : undefined}
                >
                  {line.text || ' '}
                </p>
              );
            })
          )}
        </div>
      ) : (
        <pre className="result__raw">{text}</pre>
      )}

      <footer className="result__footer">
        <span className="dot dot--low" /> Итгэлцүүр {LOW_CONFIDENCE}%-аас доош мөрийг тэмдэглэв
      </footer>
    </section>
  );
}
