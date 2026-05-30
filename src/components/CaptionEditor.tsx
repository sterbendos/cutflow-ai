import { useCaption, CaptionStyle } from '../context/CaptionContext';

const FONT_FAMILIES = [
  "'Outfit', 'Inter', sans-serif",
  "'Inter', sans-serif",
  "'Georgia', 'Times New Roman', serif",
  "'SF Mono', 'Fira Code', monospace",
  "'Playfair Display', serif",
  "'Space Grotesk', sans-serif",
];

const ANIMATIONS = ['none', 'fade', 'slide-up', 'highlight'] as const;
const POSITIONS = ['bottom', 'top'] as const;
const ALIGNMENTS = ['left', 'center', 'right'] as const;
const WORD_STYLES = ['none', 'teal-highlight', 'bold-keywords', 'gradient'] as const;

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="caption-field">
      <span className="caption-field__label">{label}</span>
      <div className="caption-field__color-row">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="caption-field__color-picker"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="caption-field__color-text"
        />
      </div>
    </div>
  );
}

function RangeSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="caption-field">
      <span className="caption-field__label">
        {label} <span className="caption-field__value">{value}{unit}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="caption-field__slider"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="caption-field">
      <span className="caption-field__label">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="caption-field__select"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt.charAt(0).toUpperCase() + opt.slice(1).replace('-', ' ')}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function CaptionEditor() {
  const { style, updateStyle, applyPreset, presets } = useCaption();

  return (
    <div className="caption-editor">
      {/* Presets */}
      <div className="caption-editor__section">
        <span className="sidebar__section-title">Presets</span>
        <div className="caption-editor__presets">
          {presets.map((preset) => (
            <button
              key={preset.name}
              className="caption-editor__preset-btn"
              onClick={() => applyPreset(preset.name)}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      {/* Font */}
      <div className="caption-editor__section">
        <span className="sidebar__section-title">Font</span>
        <SelectField
          label="Family"
          value={style.fontFamily}
          options={FONT_FAMILIES}
          onChange={(v) => updateStyle({ fontFamily: v })}
        />
        <div className="caption-field-row">
          <div style={{ flex: 1 }}>
            <RangeSlider
              label="Size"
              value={style.fontSize}
              min={12}
              max={72}
              step={1}
              unit="px"
              onChange={(v) => updateStyle({ fontSize: v })}
            />
          </div>
          <div style={{ flex: 1 }}>
            <RangeSlider
              label="Weight"
              value={style.fontWeight}
              min={300}
              max={900}
              step={100}
              onChange={(v) => updateStyle({ fontWeight: v })}
            />
          </div>
        </div>
        <ColorInput
          label="Color"
          value={style.fontColor}
          onChange={(v) => updateStyle({ fontColor: v })}
        />
        <RangeSlider
          label="Letter spacing"
          value={Math.round(style.letterSpacing * 100)}
          min={-5}
          max={20}
          step={1}
          unit="em"
          onChange={(v) => updateStyle({ letterSpacing: v / 100 })}
        />
      </div>

      {/* Background */}
      <div className="caption-editor__section">
        <span className="sidebar__section-title">Background</span>
        <ColorInput
          label="Color"
          value={style.bgColor}
          onChange={(v) => updateStyle({ bgColor: v })}
        />
        <RangeSlider
          label="Opacity"
          value={Math.round(style.bgOpacity * 100)}
          min={0}
          max={100}
          step={5}
          unit="%"
          onChange={(v) => updateStyle({ bgOpacity: v / 100 })}
        />
        <RangeSlider
          label="Rounded"
          value={style.bgRadius}
          min={0}
          max={20}
          step={1}
          unit="px"
          onChange={(v) => updateStyle({ bgRadius: v })}
        />
      </div>

      {/* Position & Alignment */}
      <div className="caption-editor__section">
        <span className="sidebar__section-title">Position</span>
        <SelectField
          label="Vertical"
          value={style.position}
          options={POSITIONS}
          onChange={(v) => updateStyle({ position: v as CaptionStyle['position'] })}
        />
        <SelectField
          label="Alignment"
          value={style.alignment}
          options={ALIGNMENTS}
          onChange={(v) => updateStyle({ alignment: v as CaptionStyle['alignment'] })}
        />
        <RangeSlider
          label="Max width"
          value={style.maxWidth}
          min={30}
          max={100}
          step={5}
          unit="%"
          onChange={(v) => updateStyle({ maxWidth: v })}
        />
      </div>

      {/* Effects */}
      <div className="caption-editor__section">
        <span className="sidebar__section-title">Effects</span>
        <SelectField
          label="Animation"
          value={style.animation}
          options={ANIMATIONS}
          onChange={(v) => updateStyle({ animation: v as CaptionStyle['animation'] })}
        />
        <SelectField
          label="Word style"
          value={style.wordStyle}
          options={WORD_STYLES}
          onChange={(v) => updateStyle({ wordStyle: v as CaptionStyle['wordStyle'] })}
        />
        <div className="caption-field">
          <label className="caption-field__checkbox">
            <input
              type="checkbox"
              checked={style.textShadow}
              onChange={(e) => updateStyle({ textShadow: e.target.checked })}
            />
            <span>Text shadow</span>
          </label>
        </div>
        {style.textShadow && (
          <>
            <ColorInput
              label="Shadow color"
              value={style.shadowColor}
              onChange={(v) => updateStyle({ shadowColor: v })}
            />
            <RangeSlider
              label="Shadow blur"
              value={style.shadowBlur}
              min={2}
              max={30}
              step={1}
              unit="px"
              onChange={(v) => updateStyle({ shadowBlur: v })}
            />
          </>
        )}
      </div>
    </div>
  );
}
