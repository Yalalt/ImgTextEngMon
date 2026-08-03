import { useEffect, useMemo, useRef, useState } from 'react';

import './App.css';
import Dropzone from './components/Dropzone.js';
import Controls from './components/Controls.js';
import ResultPanel from './components/ResultPanel.js';
import { ENGINE } from './ocr/engines.js';
import { useOcr } from './ocr/useOcr.js';

const DEFAULT_SETTINGS = {
  engine: ENGINE.TESSERACT,
  language: 'mon+eng',
  quality: 'fast',
  psm: '3',
  binarize: false,
  useDominant: true,
};

function ProgressBar({ progress }) {
  if (!progress) return null;
  const percent = progress.progress === null ? null : Math.round(progress.progress * 100);
  return (
    <div className="progress">
      <div className="progress__label">
        <span>{progress.label}</span>
        {percent !== null ? <span>{percent}%</span> : null}
      </div>
      <div className="progress__track">
        <div
          className={`progress__bar${percent === null ? ' progress__bar--indeterminate' : ''}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export default function App() {
  const [file, setFile] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsChanged, setSettingsChanged] = useState(false);

  const { status, progress, result, error, run, cancel, reset } = useOcr();

  // Тохиргоо солигдох болгонд дахин таних нь AI горимд шууд мөнгө зарцуулна.
  // Тиймээс шинэ зураг сонгоход л автоматаар ажиллаж, тохиргооны өөрчлөлтийг
  // хэрэглэгч "Дахин таних" товчоор баталгаажуулна.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    if (!previewUrl) return undefined;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (!file) return;
    setSettingsChanged(false);
    run(file, settingsRef.current);
  }, [file, run]);

  const updateSetting = (key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setSettingsChanged(true);
  };

  const busy = status === 'running';
  const baseName = file?.name?.replace(/\.[^.]+$/, '') || 'text';

  return (
    <div className="app">
      <header className="app__header">
        <h1>Зурагнаас текст</h1>
        <p className="app__subtitle">
          Монгол болон англи хэл холилдсон бичвэрийг зурагнаас гаргаж авна.
        </p>
      </header>

      <div className="app__layout">
        <div className="panel">
          <Dropzone
            file={file}
            previewUrl={previewUrl}
            disabled={busy}
            onSelect={(next) => {
              reset();
              setFile(next);
            }}
          />

          <Controls settings={settings} onChange={updateSetting} disabled={busy} />

          <div className="panel__actions">
            {busy ? (
              <button type="button" className="button button--ghost" onClick={cancel}>
                Цуцлах
              </button>
            ) : (
              <button
                type="button"
                className="button button--primary"
                disabled={!file}
                onClick={() => {
                  setSettingsChanged(false);
                  run(file, settings);
                }}
              >
                {result ? 'Дахин таних' : 'Таних'}
              </button>
            )}
            {settingsChanged && result && !busy ? (
              <span className="panel__notice">
                Тохиргоо өөрчлөгдсөн — дахин таних шаардлагатай.
              </span>
            ) : null}
          </div>

          <ProgressBar progress={progress} />

          {error ? (
            <div className="alert" role="alert">
              <strong>Алдаа</strong>
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <div className="panel panel--result">
          {result ? (
            <ResultPanel result={result} baseName={baseName} />
          ) : (
            <p className="placeholder">
              {busy
                ? 'Таниж байна…'
                : 'Зураг сонгоход танисан текст энд харагдана.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
