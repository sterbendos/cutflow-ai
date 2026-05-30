import { motion } from 'framer-motion';
import { useRef } from 'react';

// Reusing the ScissorsIcon from Header
function ScissorsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
      <line x1="20" y1="4" x2="8.12" y2="15.88"/>
      <line x1="14.47" y1="14.48" x2="20" y2="20"/>
      <line x1="8.12" y1="8.12" x2="12" y2="12"/>
    </svg>
  );
}

export default function WelcomeScreen() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.2
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: { type: 'spring', damping: 20, stiffness: 100 }
    }
  };

  return (
    <motion.div 
      className="absolute inset-0 z-50 flex items-center justify-center bg-canvas"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      style={{ background: 'var(--canvas)' }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--teal-glow)_0%,_transparent_70%)] opacity-30 pointer-events-none" />

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="relative z-10 flex flex-col items-center max-w-lg text-center"
      >
        <motion.div variants={itemVariants} className="mb-6">
          <div className="w-16 h-16 flex items-center justify-center rounded-xl bg-gradient-to-br from-teal-primary to-teal-light text-canvas shadow-[0_0_30px_rgba(20,184,166,0.3)]">
            <ScissorsIcon />
          </div>
        </motion.div>

        <motion.h1 variants={itemVariants} className="text-4xl font-bold text-text-primary tracking-tight mb-2">
          CutFlow <span className="text-teal-primary">AI</span>
        </motion.h1>

        <motion.p variants={itemVariants} className="text-text-muted text-lg mb-10">
          The next generation intelligent video editor. <br/> Smooth, fast, and elegantly designed.
        </motion.p>

        <motion.div variants={itemVariants} className="flex gap-4">
          <button 
            className="group relative px-6 py-3 font-semibold text-canvas bg-teal-primary rounded-lg overflow-hidden shadow-[0_0_20px_rgba(20,184,166,0.2)] transition-transform hover:scale-105 active:scale-95"
            onClick={() => {
              // Usually we might trigger the file dialog here via a global event or context, 
              // but since AssetBrowser is typically hidden until a file is loaded (or we show the whole workspace),
              // maybe we just prompt the user to drag a file or we use a custom event.
              // For now, we will add an event to dispatch or simply let them click to trigger a hidden input if we expose it via context.
              const ev = new CustomEvent('open-add-media');
              window.dispatchEvent(ev);
            }}
          >
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            <span className="relative flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New Project
            </span>
          </button>
        </motion.div>

      </motion.div>
    </motion.div>
  );
}
