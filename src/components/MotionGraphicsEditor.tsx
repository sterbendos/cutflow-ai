import { useState } from 'react';
import { useTimeline } from '../context/TimelineContext';
import {
  useMotionGraphics,
  MgTemplate,
} from '../context/MotionGraphicsContext';

const TEMPLATE_LIST: { key: MgTemplate; label: string; desc: string }[] = [
  { key: 'lower-third', label: 'Lower Third', desc: 'Name + title bar' },
  { key: 'title-card', label: 'Title Card', desc: 'Centered headline' },
  { key: 'quote', label: 'Quote', desc: 'Styled quote overlay' },
  { key: 'label', label: 'Label', desc: 'Small corner label' },
  { key: 'section-header', label: 'Section', desc: 'Chapter heading' },
];

export default function MotionGraphicsEditor() {
  const { state } = useTimeline();
  const { items, addFromTemplate, removeItem } = useMotionGraphics();

  const [selectedTemplate, setSelectedTemplate] = useState<MgTemplate>('lower-third');
  const [text, setText] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [startTime, setStartTime] = useState(0);
  const [duration, setDuration] = useState(5);

  const durationMax = Math.max(state.edl.map((s) => s.end).reduce((a, b) => Math.max(a, b), 60), 60);

  const handleAdd = () => {
    if (!text.trim()) return;
    addFromTemplate(selectedTemplate, text.trim(), subtitle.trim(), startTime, startTime + duration);
    setText('');
    setSubtitle('');
  };

  return (
    <div className="mg-editor">
      {/* Template Selection */}
      <div className="caption-editor__section">
        <span className="sidebar__section-title">Add Graphic</span>
        <div className="mg-editor__templates">
          {TEMPLATE_LIST.map((t) => (
            <button
              key={t.key}
              className={`mg-editor__template-btn${selectedTemplate === t.key ? ' active' : ''}`}
              onClick={() => setSelectedTemplate(t.key)}
              title={t.desc}
            >
              <span className="mg-editor__template-label">{t.label}</span>
              <span className="mg-editor__template-desc">{t.desc}</span>
            </button>
          ))}
        </div>

        {/* Text inputs */}
        <div className="caption-field">
          <span className="caption-field__label">Text</span>
          <input
            className="caption-field__select"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter text..."
            style={{ fontFamily: 'inherit' }}
          />
        </div>
        <div className="caption-field">
          <span className="caption-field__label">Subtitle (optional)</span>
          <input
            className="caption-field__select"
            type="text"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="Subtitle..."
            style={{ fontFamily: 'inherit' }}
          />
        </div>

        {/* Timing */}
        <div className="caption-field-row">
          <div style={{ flex: 1 }}>
            <div className="caption-field">
              <span className="caption-field__label">Start</span>
              <input
                className="caption-field__select"
                type="number"
                min={0}
                max={durationMax}
                step={0.5}
                value={startTime}
                onChange={(e) => setStartTime(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="caption-field">
              <span className="caption-field__label">Duration (s)</span>
              <input
                className="caption-field__select"
                type="number"
                min={1}
                max={120}
                step={0.5}
                value={duration}
                onChange={(e) => setDuration(parseFloat(e.target.value) || 5)}
              />
            </div>
          </div>
        </div>

        <button
          className="mg-editor__add-btn"
          onClick={handleAdd}
          disabled={!text.trim()}
        >
          + Add to Timeline
        </button>
      </div>

      {/* Active items list */}
      {items.length > 0 && (
        <div className="caption-editor__section" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <span className="sidebar__section-title">Graphics ({items.length})</span>
          <div className="mg-editor__list">
            {items.map((item) => (
              <div key={item.id} className="mg-editor__item">
                <div className="mg-editor__item-info">
                  <span className="mg-editor__item-text">{item.text}</span>
                  <span className="mg-editor__item-time">
                    {item.startTime.toFixed(1)}s – {item.endTime.toFixed(1)}s
                  </span>
                </div>
                <button
                  className="mg-editor__item-del"
                  onClick={() => removeItem(item.id)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
