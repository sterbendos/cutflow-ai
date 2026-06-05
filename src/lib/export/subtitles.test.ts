import { describe, expect, test } from 'vitest';
import { generateSrtForExport, normalizeTranscript } from './subtitles';

describe('subtitle export helpers', () => {
  test('normalizes transcript arrays and transcript payload objects', () => {
    expect(normalizeTranscript({
      transcript: [
        { text: ' hello ', start: 1, end: 1.2 },
        { text: '', start: 2, end: 3 },
        { text: 'bad', start: 4, end: 3 },
      ],
    })).toEqual([{ text: 'hello', start: 1, end: 1.2 }]);
  });

  test('maps source word timings into the exported keep-only timeline', () => {
    const srt = generateSrtForExport(
      [
        { text: 'first', start: 1, end: 1.4 },
        { text: 'cut', start: 5.1, end: 5.3 },
        { text: 'second', start: 11, end: 11.4 },
      ],
      [
        { start: 0, end: 2, segment_type: 'keep' },
        { start: 5, end: 10, segment_type: 'user-deleted' },
        { start: 10, end: 12, segment_type: 'keep' },
      ]
    );

    expect(srt).toContain('1\n00:00:01,000 --> 00:00:01,500\nfirst');
    expect(srt).toContain('2\n00:00:03,000 --> 00:00:03,500\nsecond');
    expect(srt).not.toContain('cut');
  });
});
