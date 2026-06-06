// CutFlow AI — Transform Inspector
// Inspect and edit the spatial transform properties (scale, x, y, rotation, opacity)
// for the currently-selected B-Roll segment. Also exposes CSS filter effects.

import { useCallback, useState } from 'react';
import { SpatialProperties, useTimeline } from '@/context/TimelineContext';

// ─── Default spatial values ────────────────────────────────────
const DEFAULT_SPATIAL: SpatialProperties = {
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
  opacity: 1,
};

// ─── Slider Row ───────────────────────────────────────────────
function SliderRow({
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {value.toFixed(step < 1 ? 2 : 0)}{unit ?? ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--teal-primary)', cursor: 'pointer' }}
      />
    </div>
  );
}

// ─── Effects Filter Config ────────────────────────────────────
export interface EffectFilters {
  brightness: number;  // 0-200 (100 = normal)
  contrast: number;    // 0-200
  saturation: number;  // 0-200
  blur: number;        // 0-20 (px)
  hueRotate: number;   // 0-360 (deg)
}

export const DEFAULT_EFFECTS: EffectFilters = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  blur: 0,
  hueRotate: 0,
};

export function effectsToCssFilter(effects: EffectFilters): string {
  const parts: string[] = [];
  if (effects.brightness !== 100) parts.push(`brightness(${effects.brightness}%)`);
  if (effects.contrast !== 100) parts.push(`contrast(${effects.contrast}%)`);
  if (effects.saturation !== 100) parts.push(`saturate(${effects.saturation}%)`);
  if (effects.blur > 0) parts.push(`blur(${effects.blur}px)`);
  if (effects.hueRotate !== 0) parts.push(`hue-rotate(${effects.hueRotate}deg)`);
  return parts.join(' ');
}

// ─── Main Component ───────────────────────────────────────────

interface TransformInspectorProps {
  selectedBRollId: string | null;
  effects: EffectFilters;
  onEffectsChange: (e: EffectFilters) => void;
}

export default function TransformInspector({
  selectedBRollId,
  effects,
  onEffectsChange,
}: TransformInspectorProps) {
  const { bRolls, updateBRollSegment } = useTimeline();
  const [activeTab, setActiveTab] = useState<'transform' | 'effects'>('transform');

  const selectedSegment = selectedBRollId
    ? bRolls.find((b) => b.id === selectedBRollId) ?? null
    : null;

  const spatial = selectedSegment?.spatial ?? DEFAULT_SPATIAL;

  const updateSpatial = useCallback(
    (key: keyof SpatialProperties, value: number) => {
      if (!selectedSegment) return;
      updateBRollSegment(selectedSegment.id, {
        spatial: { ...spatial, [key]: value },
      });
    },
    [selectedSegment, spatial, updateBRollSegment]
  );

  const resetSpatial = useCallback(() => {
    if (!selectedSegment) return;
    updateBRollSegment(selectedSegment.id, { spatial: { ...DEFAULT_SPATIAL } });
  }, [selectedSegment, updateBRollSegment]);

  const resetEffects = useCallback(() => {
    onEffectsChange({ ...DEFAULT_EFFECTS });
  }, [onEffectsChange]);

  const tabStyle = (tab: 'transform' | 'effects'): React.CSSProperties => ({
    flex: 1,
    padding: '6px 0',
    background: activeTab === tab ? 'var(--teal-primary)' : 'transparent',
    color: activeTab === tab ? '#fff' : 'var(--text-muted)',
    border: 'none',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    cursor: 'pointer',
    borderRadius: 4,
    transition: 'all 0.15s ease',
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '12px 14px',
        background: 'var(--surface-2)',
        borderRadius: 8,
        border: '1px solid var(--border)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          Inspector
        </span>
        {selectedSegment && (
          <span style={{ fontSize: 10, color: 'var(--teal-primary)', fontWeight: 600, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedSegment.name}
          </span>
        )}
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--surface-1)', borderRadius: 6, padding: 3 }}>
        <button style={tabStyle('transform')} onClick={() => setActiveTab('transform')}>Transform</button>
        <button style={tabStyle('effects')} onClick={() => setActiveTab('effects')}>Effects</button>
      </div>

      {/* Tab Content */}
      {activeTab === 'transform' ? (
        selectedSegment ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <SliderRow label="Scale" value={spatial.scale} min={0.1} max={3} step={0.01} onChange={(v) => updateSpatial('scale', v)} />
            <SliderRow label="Position X" value={spatial.x} min={-1} max={1} step={0.01} onChange={(v) => updateSpatial('x', v)} />
            <SliderRow label="Position Y" value={spatial.y} min={-1} max={1} step={0.01} onChange={(v) => updateSpatial('y', v)} />
            <SliderRow label="Rotation" value={spatial.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => updateSpatial('rotation', v)} />
            <SliderRow label="Opacity" value={spatial.opacity} min={0} max={1} step={0.01} onChange={(v) => updateSpatial('opacity', v)} />
            <button
              onClick={resetSpatial}
              style={{
                marginTop: 4,
                padding: '5px 10px',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-muted)',
                fontSize: 10,
                cursor: 'pointer',
                alignSelf: 'flex-start',
              }}
            >
              Reset Transform
            </button>
          </div>
        ) : (
          <p style={{ fontSize: 11, color: 'var(--text-subtle)', textAlign: 'center', padding: '12px 0' }}>
            Click a B-Roll segment on the timeline to inspect it
          </p>
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SliderRow label="Brightness" value={effects.brightness} min={0} max={200} step={1} unit="%" onChange={(v) => onEffectsChange({ ...effects, brightness: v })} />
          <SliderRow label="Contrast" value={effects.contrast} min={0} max={200} step={1} unit="%" onChange={(v) => onEffectsChange({ ...effects, contrast: v })} />
          <SliderRow label="Saturation" value={effects.saturation} min={0} max={200} step={1} unit="%" onChange={(v) => onEffectsChange({ ...effects, saturation: v })} />
          <SliderRow label="Blur" value={effects.blur} min={0} max={20} step={0.5} unit="px" onChange={(v) => onEffectsChange({ ...effects, blur: v })} />
          <SliderRow label="Hue Rotate" value={effects.hueRotate} min={0} max={360} step={1} unit="°" onChange={(v) => onEffectsChange({ ...effects, hueRotate: v })} />

          {/* Presets */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Presets</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {[
                { name: 'Cinematic', e: { brightness: 90, contrast: 110, saturation: 80, blur: 0, hueRotate: 0 } },
                { name: 'Vintage', e: { brightness: 95, contrast: 90, saturation: 70, blur: 0, hueRotate: 15 } },
                { name: 'B&W', e: { brightness: 100, contrast: 120, saturation: 0, blur: 0, hueRotate: 0 } },
                { name: 'Cold', e: { brightness: 100, contrast: 105, saturation: 90, blur: 0, hueRotate: 200 } },
                { name: 'Warm', e: { brightness: 105, contrast: 100, saturation: 110, blur: 0, hueRotate: 20 } },
                { name: 'Dream', e: { brightness: 110, contrast: 80, saturation: 120, blur: 2, hueRotate: 0 } },
              ].map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => onEffectsChange(preset.e)}
                  style={{
                    padding: '4px 8px',
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-muted)',
                    fontSize: 10,
                    cursor: 'pointer',
                  }}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={resetEffects}
            style={{
              padding: '5px 10px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--text-muted)',
              fontSize: 10,
              cursor: 'pointer',
              alignSelf: 'flex-start',
            }}
          >
            Reset Effects
          </button>
        </div>
      )}
    </div>
  );
}
