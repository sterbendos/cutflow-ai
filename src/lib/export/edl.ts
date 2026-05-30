// CutFlow AI — CMX3600 EDL Export
// Standard Edit Decision List compatible with DaVinci Resolve, Premiere Pro, Avid.

import type { ExportClip } from './fcpxml';

function fmtEdlTc(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.round((seconds % 1) * 30); // assume 30 fps drop-frame
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

export function generateEdl(
  clips: ExportClip[],
  projectName: string,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`TITLE: ${projectName}`);
  lines.push('FCM: NON-DROP FRAME');
  lines.push('');

  clips.forEach((clip, i) => {
    const num = i + 1;
    const reel = clip.name.replace(/\..+$/, '').replace(/[^A-Za-z0-9]/g, '_').slice(0, 7);
    const track = 'AA/V';  // Video + Audio
    const inTc = fmtEdlTc(clip.start);
    const outTc = fmtEdlTc(clip.end);
    const srcInTc = fmtEdlTc(0);           // source start at 0
    const srcOutTc = fmtEdlTc(clip.duration);

    if (clip.transition && clip.transition !== 'none' && i > 0) {
      const transName = clip.transition === 'cross-dissolve' ? 'D' : 'F';
      const transDur = fmtEdlTc(clip.transitionDuration || 0.3);
      lines.push(`${String(num).padStart(3)}  ${reel.padEnd(8)} ${track}  C        ${inTc} ${outTc} ${srcInTc} ${srcOutTc}`);
      lines.push(`* TRANSITION ${transName} ${transDur}`);
    } else {
      lines.push(`${String(num).padStart(3)}  ${reel.padEnd(8)} ${track}  C        ${inTc} ${outTc} ${srcInTc} ${srcOutTc}`);
    }
    lines.push(`* FROM CLIP NAME: ${clip.name}`);
    lines.push(`* SOURCE FILE: ${clip.srcFile}`);
    lines.push('');
  });

  return lines.join('\n');
}
