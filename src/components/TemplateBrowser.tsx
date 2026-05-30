// CutFlow AI — Template Browser
// Visual gallery for browsing and applying motion graphics templates.

import { useState, useMemo } from 'react';
import { useTimeline } from '@/context/TimelineContext';
import { useMotionGraphics } from '@/context/MotionGraphicsContext';
import {
  MgTemplate,
  MG_TEMPLATES,
  getTemplatesByCategory,
  getAllCategories,
} from '@/templates/motion-graphics';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Animation Variants ────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: { 
    opacity: 1, 
    scale: 1, 
    y: 0,
    transition: { type: 'spring', damping: 20, stiffness: 150 }
  }
};

// ─── Category Icons ──────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  'lower-thirds': { label: 'Lower Thirds', icon: 'LT' },
  'titles':        { label: 'Titles',        icon: 'T' },
  'callouts':      { label: 'Callouts',      icon: '™' },
  'social':        { label: 'Social',        icon: '@' },
  'branding':      { label: 'Branding',      icon: '©' },
};

// ─── Mini Preview ────────────────────────────────────────────
// Renders a simplified preview of what the template looks like

function TemplatePreview({ template }: { template: MgTemplate }) {
  const { config } = template;
  const isCentered = config.positionX >= 45 && config.positionX <= 55;

  return (
    <div
      style={{
        width: '100%',
        height: 64,
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        borderRadius: 'var(--radius-sm)',
        position: 'relative',
        overflow: 'hidden',
        border: '1px solid var(--border)',
      }}
    >
      {/* Simulated text overlay */}
      <div
        style={{
          position: 'absolute',
          left: isCentered ? '50%' : `${config.positionX}%`,
          top: `${config.positionY}%`,
          transform: isCentered ? 'translate(-50%, -50%)' : 'translate(0, -50%)',
          background: config.bgOpacity > 0 ? config.bgColor : 'transparent',
          opacity: 0.9,
          padding: '4px 8px',
          borderRadius: 3,
          maxWidth: '90%',
          textAlign: isCentered ? 'center' : 'left',
        }}
      >
        <div
          style={{
            fontSize: isCentered ? 12 : 10,
            fontWeight: config.fontWeight,
            color: config.fontColor,
            fontFamily: 'sans-serif',
            textTransform: config.textTransform || 'none',
            letterSpacing: config.letterSpacing || 0,
            lineHeight: 1.3,
          }}
        >
          <span style={{ color: config.accentColor }}>▎</span>
          {template.name}
        </div>
        <div style={{ fontSize: 8, color: config.accentColor, opacity: 0.8, marginTop: 1 }}>
          {template.category === 'lower-thirds' ? 'Name • Title' : template.category}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────

export default function TemplateBrowser() {
  const { state } = useTimeline();
  const { items, addFromTemplate, removeItem } = useMotionGraphics();

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<string>(MG_TEMPLATES[0]?.id ?? '');
  const [text, setText] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(10);

  const categories = getAllCategories();

  const filteredTemplates = useMemo(() => {
    if (activeCategory === 'all') return MG_TEMPLATES;
    return getTemplatesByCategory(activeCategory as any);
  }, [activeCategory]);

  const currentTemplate = useMemo(
    () => MG_TEMPLATES.find(t => t.id === selectedTemplate),
    [selectedTemplate]
  );

  const durationMax = Math.max(
    state.edl.map((s) => s.end).reduce((a, b) => Math.max(a, b), 60),
    60
  );

  const handleApply = () => {
    if (!text.trim() || !currentTemplate) return;
    addFromTemplate(
      currentTemplate.id,
      text.trim(),
      subtitle.trim(),
      startTime,
      endTime
    );
    setText('');
    setSubtitle('');
    setEndTime(startTime + 10);
  };

  return (
    <div className="template-browser">
      {/* Category Filter Pills */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
        <button
          onClick={() => setActiveCategory('all')}
          style={{
            padding: '3px 8px',
            fontSize: 10,
            fontWeight: 600,
            background: activeCategory === 'all' ? 'var(--teal-primary)' : 'var(--surface)',
            color: activeCategory === 'all' ? '#fff' : 'var(--text-muted)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
          }}
        >
          All ({MG_TEMPLATES.length})
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              padding: '3px 8px',
              fontSize: 10,
              fontWeight: 600,
              background: activeCategory === cat ? 'var(--teal-primary)' : 'var(--surface)',
              color: activeCategory === cat ? '#fff' : 'var(--text-muted)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            {CATEGORY_META[cat]?.label || cat}
          </button>
        ))}
      </div>

      {/* Template Grid */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
          marginBottom: 12,
        }}
      >
        {filteredTemplates.map((tpl) => {
          const isSelected = selectedTemplate === tpl.id;
          return (
            <motion.button
              key={tpl.id}
              variants={itemVariants}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedTemplate(tpl.id)}
              style={{
                padding: 0,
                background: 'none',
                border: isSelected ? '2px solid var(--teal-primary)' : '2px solid transparent',
                borderRadius: 'calc(var(--radius-sm) + 2px)',
                cursor: 'pointer',
                overflow: 'hidden',
              }}
              title={tpl.description}
            >
              <TemplatePreview template={tpl} />
              <div
                style={{
                  padding: '3px 4px',
                  fontSize: 9,
                  color: isSelected ? 'var(--teal-primary)' : 'var(--text-subtle)',
                  fontWeight: isSelected ? 600 : 400,
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {tpl.name}
              </div>
            </motion.button>
          );
        })}
      </motion.div>

      {/* Apply Form */}
      {currentTemplate && (
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: 10,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6 }}>
            Apply: {currentTemplate.name}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Main text..."
              className="caption-field__select"
              style={{ padding: '6px 8px', fontSize: 12 }}
            />
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Subtitle / secondary (optional)"
              className="caption-field__select"
              style={{ padding: '6px 8px', fontSize: 12 }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: 'var(--text-subtle)', marginBottom: 2 }}>Start (s)</div>
                <input
                  type="number"
                  min={0}
                  max={durationMax}
                  step={0.5}
                  value={startTime}
                  onChange={(e) => setStartTime(parseFloat(e.target.value) || 0)}
                  className="caption-field__select"
                  style={{ padding: '4px 6px', fontSize: 11, width: '100%' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: 'var(--text-subtle)', marginBottom: 2 }}>End (s)</div>
                <input
                  type="number"
                  min={startTime + 1}
                  max={durationMax}
                  step={0.5}
                  value={endTime}
                  onChange={(e) => setEndTime(parseFloat(e.target.value) || startTime + 1)}
                  className="caption-field__select"
                  style={{ padding: '4px 6px', fontSize: 11, width: '100%' }}
                />
              </div>
            </div>
            <button
              onClick={handleApply}
              disabled={!text.trim()}
              style={{
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 600,
                background: 'var(--teal-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                opacity: !text.trim() ? 0.5 : 1,
              }}
            >
              + Add to Timeline
            </button>
          </div>
        </div>
      )}

      {/* Active Graphics List */}
      {items.length > 0 && (
        <div
          style={{
            marginTop: 10,
            borderTop: '1px solid var(--border)',
            paddingTop: 8,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6 }}>
            Active Graphics ({items.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {items.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 6px',
                  background: 'var(--canvas)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.text}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-subtle)' }}>
                    {item.startTime.toFixed(1)}s → {item.endTime.toFixed(1)}s
                  </div>
                </div>
                <button
                  onClick={() => removeItem(item.id)}
                  style={{
                    padding: '2px 6px',
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    background: 'none',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
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
