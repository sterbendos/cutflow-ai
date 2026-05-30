// CutFlow AI — Filler Word Detection
// Common filler words and hesitation sounds across multiple languages.

export const FILLER_WORDS = new Set([
  // English
  'um', 'uh', 'er', 'ah', 'like', 'you know', 'i mean', 'sort of',
  'kind of', 'actually', 'basically', 'literally', 'so', 'well',
  'right', 'okay', 'ok', 'anyway', 'obviously', 'essentially',
  'honestly', 'seriously', 'technically', 'totally', 'absolutely',
  'just', 'really', 'very', 'pretty', 'quite', 'rather',
  'hmm', 'uh huh', 'uh-huh', 'mm hmm', 'mm-hmm', 'uh oh',
  
  // Filler phrases (multi-word)
  'at the end of the day', 'at the end',
  'when it comes to', 'when it comes',
  'the thing is', 'the truth is', 'the fact is',
  'i guess', 'i suppose', 'i think',
  'you know what i mean', 'you see',
  'if you will', 'if you like',
  'as i was saying', 'as i said',
  'believe it or not',
  'needless to say',
  'it goes without saying',
  'more or less',
  'by the way',
]);

export function isFillerWord(word: string): boolean {
  return FILLER_WORDS.has(word.toLowerCase().replace(/[^a-z\s'-]/g, ''));
}

export function findFillerRanges(
  words: Array<{ text: string; start: number; end: number }>
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let i = 0;

  while (i < words.length) {
    // Skip non-filler words
    if (!isFillerWord(words[i].text)) {
      i++;
      continue;
    }

    // Found a filler — expand to include adjacent fillers
    let j = i;
    while (j < words.length && isFillerWord(words[j].text)) {
      j++;
    }

    ranges.push({
      start: words[i].start,
      end: words[j - 1].end,
    });

    i = j;
  }

  return ranges;
}
