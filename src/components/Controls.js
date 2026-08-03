import {
  ENGINE,
  ENGINE_OPTIONS,
  LANGUAGE_OPTIONS,
  QUALITY_OPTIONS,
  PSM_OPTIONS,
  findQuality,
} from '../ocr/engines.js';

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

/**
 * Танилтын тохиргоо. Tesseract-д хамаарах сонголтууд нь AI горим дээр
 * утгагүй тул нуугдана.
 */
export default function Controls({ settings, onChange, disabled }) {
  const isTesseract = settings.engine === ENGINE.TESSERACT;
  const engineHint = ENGINE_OPTIONS.find((e) => e.value === settings.engine)?.hint;
  const qualityHint = findQuality(settings.quality).hint;

  return (
    <div className="controls">
      <Field label="Хөдөлгүүр" hint={engineHint}>
        <select
          value={settings.engine}
          disabled={disabled}
          onChange={(event) => onChange('engine', event.target.value)}
        >
          {ENGINE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      {isTesseract ? (
        <>
          <Field label="Хэл">
            <select
              value={settings.language}
              disabled={disabled}
              onChange={(event) => onChange('language', event.target.value)}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Загварын чанар" hint={qualityHint}>
            <select
              value={settings.quality}
              disabled={disabled}
              onChange={(event) => onChange('quality', event.target.value)}
            >
              {QUALITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Хуудасны бүтэц">
            <select
              value={settings.psm}
              disabled={disabled}
              onChange={(event) => onChange('psm', event.target.value)}
            >
              {PSM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : (
        <Field label="AI горим" hint="Зураг серверээр дамжин Claude руу очно. Нэг зураг ≈ $0.04.">
          <span className="field__static">claude-opus-5</span>
        </Field>
      )}

      <div className="toggles">
        {isTesseract ? (
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.binarize}
              disabled={disabled}
              onChange={(event) => onChange('binarize', event.target.checked)}
            />
            <span>
              Гэрэл зургийн горим
              <small>Тэгш бус гэрэлтэй, сүүдэртэй зурагт адаптив хоёртчлол хийнэ</small>
            </span>
          </label>
        ) : null}

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.useDominant}
            disabled={disabled}
            onChange={(event) => onChange('useDominant', event.target.checked)}
          />
          <span>
            Тодорхойгүй үгийг баримтын хэлээр шийдэх
            <small>
              Бүхэлдээ хоёрдмол үг (ж: XAPAX) давамгай хэл рүү хөрвөнө. Англи
              товчлол ихтэй баримтад унтраахыг зөвлөнө.
            </small>
          </span>
        </label>
      </div>
    </div>
  );
}
