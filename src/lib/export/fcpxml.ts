// CutFlow AI — Final Cut Pro 7 XML Export
// Generates an FCPXML 1.0 document from the current timeline EDL.
// Compatible with Final Cut Pro 7, DaVinci Resolve, and Premiere Pro (via XML import).

export interface ExportClip {
  id: string;
  name: string;
  srcFile: string;        // Absolute path to source video
  start: number;          // Start time in source (seconds)
  end: number;            // End time in source (seconds)
  duration: number;       // Play duration (seconds)
  transition?: 'none' | 'cross-dissolve' | 'fade';
  transitionDuration?: number;
}

function fmtTc(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.round((seconds % 1) * 24);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function generateFcpxml(
  clips: ExportClip[],
  projectName: string,
  frameRate: number = 30,
): string {
  const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0);
  const totalTc = fmtTc(totalDuration);

  let clipItemsXml = '';
  let transitionDefs = '';
  let transitionId = 0;

  clips.forEach((clip, i) => {
    const inTc = fmtTc(clip.start);
    const outTc = fmtTc(clip.end);
    const durationTc = fmtTc(clip.duration);

    clipItemsXml += `          <clipitem id="clip-${i + 1}">
            <masterclipid>master-${escXml(clip.id)}</masterclipid>
            <name>${escXml(clip.name)}</name>
            <duration>${durationTc}</duration>
            <rate>
              <timebase>${frameRate}</timebase>
              <ntsc>${frameRate === 29.97 ? 'TRUE' : 'FALSE'}</ntsc>
            </rate>
            <in>${inTc}</in>
            <out>${outTc}</out>
            <file id="file-${i + 1}">
              <name>${escXml(clip.name)}</name>
              <pathurl>${escXml(clip.srcFile)}</pathurl>
              <rate>
                <timebase>${frameRate}</timebase>
                <ntsc>${frameRate === 29.97 ? 'TRUE' : 'FALSE'}</ntsc>
              </rate>
              <duration>${fmtTc(clip.end - clip.start)}</duration>
            </file>
            <sourcetrack>
              <mediatype>video</mediatype>
            </sourcetrack>
            <sourcetrack>
              <mediatype>audio</mediatype>
            </sourcetrack>
            <link>
              <linkclipref>clip-${i + 1}</linkclipref>
              <mediatype>video</mediatype>
              <trackindex>1</trackindex>
              <clipindex>${i + 1}</clipindex>
            </link>
            <link>
              <linkclipref>clip-${i + 1}</linkclipref>
              <mediatype>audio</mediatype>
              <trackindex>1</trackindex>
              <clipindex>${i + 1}</clipindex>
            </link>
          </clipitem>\n`;

    if (clip.transition && clip.transition !== 'none' && i < clips.length - 1) {
      transitionId++;
      const transName = clip.transition === 'cross-dissolve' ? 'Cross Dissolve' : 'Fade';
      transitionDefs += `          <transition id="transition-${transitionId}">
            <name>${transName}</name>
            <duration>${fmtTc(clip.transitionDuration || 0.3)}</duration>
            <rate>
              <timebase>${frameRate}</timebase>
              <ntsc>${frameRate === 29.97 ? 'TRUE' : 'FALSE'}</ntsc>
            </rate>
            <effect>
              <name>${transName}</name>
              <effectid>${transName === 'Cross Dissolve' ? 'cross_dissolve' : 'fade'}</effectid>
              <effecttype>transition</effecttype>
              <mediatype>video</mediatype>
            </effect>
            <startclip>clip-${i + 1}</startclip>
            <endclip>clip-${i + 2}</endclip>
          </transition>\n`;
    }
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="sequence-1">
    <name>${escXml(projectName)}</name>
    <duration>${totalTc}</duration>
    <rate>
      <timebase>${frameRate}</timebase>
      <ntsc>${frameRate === 29.97 ? 'TRUE' : 'FALSE'}</ntsc>
    </rate>
    <media>
      <video>
        <track>
          ${clipItemsXml}${transitionDefs ? `          <!-- Transitions -->\n${transitionDefs}` : ''}        </track>
        <enabled>TRUE</enabled>
        <locked>FALSE</locked>
      </video>
      <audio>
        <track>
          ${clipItemsXml}        </track>
        <enabled>TRUE</enabled>
        <locked>FALSE</locked>
      </audio>
    </media>
    <timecode>
      <rate>
        <timebase>${frameRate}</timebase>
        <ntsc>${frameRate === 29.97 ? 'TRUE' : 'FALSE'}</ntsc>
      </rate>
      <string>00:00:00:00</string>
      <frame>0</frame>
      <source>source</source>
      <displayformat>NDF</displayformat>
    </timecode>
    <in>00:00:00:00</in>
    <out>${totalTc}</out>
  </sequence>
</xmeml>`;
}
