import { useCallback, useId, useRef, useState } from 'react';

/**
 * Зураг сонгох талбар: чирж оруулах эсвэл дарж сонгох.
 */
export default function Dropzone({ file, previewUrl, onSelect, disabled }) {
  const inputId = useId();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const pick = useCallback(
    (candidate) => {
      if (!candidate) return;
      if (!candidate.type.startsWith('image/')) return;
      onSelect(candidate);
    },
    [onSelect],
  );

  const handleDrop = useCallback(
    (event) => {
      event.preventDefault();
      setDragging(false);
      if (disabled) return;
      pick(event.dataTransfer.files?.[0]);
    },
    [disabled, pick],
  );

  return (
    <div
      className={`dropzone${dragging ? ' dropzone--active' : ''}${
        disabled ? ' dropzone--disabled' : ''
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        disabled={disabled}
        className="dropzone__input"
        onChange={(event) => {
          pick(event.target.files?.[0]);
          // Ижил файлыг дахин сонгоход `change` дахин ажиллах боломж олгоно.
          event.target.value = '';
        }}
      />

      {previewUrl ? (
        <div className="dropzone__preview">
          <img src={previewUrl} alt={file?.name || 'Сонгосон зураг'} />
          <div className="dropzone__meta">
            <span className="dropzone__filename">{file?.name}</span>
            <label htmlFor={inputId} className="button button--ghost">
              Өөр зураг
            </label>
          </div>
        </div>
      ) : (
        <label htmlFor={inputId} className="dropzone__empty">
          <span className="dropzone__icon" aria-hidden="true">
            🖼️
          </span>
          <strong>Зургаа чирж оруулна уу</strong>
          <span className="dropzone__hint">эсвэл дарж компьютерээсээ сонгоно уу</span>
        </label>
      )}
    </div>
  );
}
