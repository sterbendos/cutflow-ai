// CutFlow AI — Motion Graphics Natural Language Parser
// Extracts template type, text, subtitle, and timing from free-form user prompts.
// Examples:
//   "add a lower third that says John Doe"
//   "add a lower third with John Doe - Software Engineer"
//   "show title Hello World at 5 seconds"
//   "add a quote The early bird catches the worm"
//   "add callout top left: Important Note"
//   "show social tag @cutflow_ai from 10 to 20"
//   "add a lower third saying Jane Doe as Marketing Director with glass style"

export interface ParsedMotionCommand {
  template: string;
  text: string;
  subtitle?: string;
  startTime?: number;
  endTime?: number;
  style?: string;
}

const TEMPLATE_ALIASES: Record<string, string[]> = {
  'lt-clean': ['clean lower third', 'simple lower third', 'minimal lower third', 'lower third clean'],
  'lt-modern': ['modern lower third', 'lower third modern', 'sleek lower third'],
  'lt-bold': ['bold lower third', 'lower third bold', 'thick lower third'],
  'lt-glass': ['glass lower third', 'transparent lower third', 'frosted lower third', 'lower third glass'],
  'title-center': ['centered title', 'center title', 'title centered', 'title', 'heading', 'headline'],
  'title-bottom': ['bottom title', 'title bottom', 'lower title'],
  'title-gradient': ['gradient title', 'title gradient', 'fancy title', 'colorful title'],
  'callout-top-left': ['top left callout', 'callout top left', 'corner callout', 'top left text'],
  'callout-quote': ['quote', 'callout quote', 'quotation', 'quote overlay', 'blockquote'],
  'callout-highlight': ['highlight', 'callout highlight', 'highlight box', 'emphasis', 'important note'],
  'social-tag': ['social tag', 'social handle', 'social', 'username', 'handle'],
  'social-subscribe': ['subscribe', 'subscribe callout', 'subscribe button', 'follow'],
  'social-hashtags': ['hashtags', 'hashtag', 'tags'],
  'brand-watermark': ['watermark', 'brand watermark', 'logo text'],
  'brand-countdown': ['countdown', 'countdown timer', 'timer'],
};

function matchTemplate(input: string): string | null {
  const lower = input.toLowerCase();

  // Direct ID match
  if (TEMPLATE_ALIASES[lower]) return lower;

  // Alias match
  for (const [id, aliases] of Object.entries(TEMPLATE_ALIASES)) {
    for (const alias of aliases) {
      if (lower.includes(alias)) return id;
    }
  }

  return null;
}

function extractTime(text: string, prefix: string): number | undefined {
  const pattern = new RegExp(`${prefix}\\s+(\\d+)(?:\\.(\\d+))?`, 'i');
  const match = text.match(pattern);
  if (match) {
    return parseFloat(`${match[1]}.${match[2] || '0'}`);
  }
  return undefined;
}

export function parseMotionPrompt(prompt: string): ParsedMotionCommand | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;

  const result: ParsedMotionCommand = {
    template: 'lt-clean',
    text: trimmed,
  };

  // Extract timings (before we modify the text)
  result.startTime = extractTime(trimmed, 'at|from|starting at|start');
  result.endTime = extractTime(trimmed, 'to|until|end|ending at');

  // Extract style keywords
  const styleMap: Record<string, string> = {
    glass: 'lt-glass',
    transparent: 'lt-glass',
    frosted: 'lt-glass',
    clean: 'lt-clean',
    simple: 'lt-clean',
    minimal: 'lt-clean',
    modern: 'lt-modern',
    sleek: 'lt-modern',
    bold: 'lt-bold',
    thick: 'lt-bold',
    fancy: 'title-gradient',
    colorful: 'title-gradient',
    gradient: 'title-gradient',
    center: 'title-center',
    bottom: 'title-bottom',
    quote: 'callout-quote',
    highlight: 'callout-highlight',
    watermark: 'brand-watermark',
    countdown: 'brand-countdown',
    subscribe: 'social-subscribe',
    hashtag: 'social-hashtags',
  };

  // Detect template from text
  const matchedId = matchTemplate(trimmed);
  if (matchedId) {
    result.template = matchedId;

    // Remove the template alias words from the text
    const lower = trimmed.toLowerCase();
    const aliases = TEMPLATE_ALIASES[matchedId] || [];
    let textWithoutTemplate = trimmed;
    for (const alias of aliases.sort((a, b) => b.length - a.length)) {
      const idx = lower.indexOf(alias);
      if (idx !== -1) {
        textWithoutTemplate = textWithoutTemplate.slice(0, idx) + textWithoutTemplate.slice(idx + alias.length);
        break;
      }
    }

    // Remove intro verbs
    let cleaned = textWithoutTemplate
      .replace(/\b(add|show|display|put|place|insert|create|make|render)\b/gi, '')
      .replace(/\b(a|an|the|that|with|using|in|at|for|on|from|to)\b/gi, '')
      .replace(/\b(says?|saying|called|named|titled|entitled)\b/gi, '')
      .replace(/\bof\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Remove timing fragments
    cleaned = cleaned.replace(/(at|from|starting at|start)\s+\d+(\.\d+)?/gi, '');
    cleaned = cleaned.replace(/(to|until|end|ending at)\s+\d+(\.\d+)?/gi, '');
    cleaned = cleaned.replace(/style\s+\w+/gi, '');

    // Remove trailing prepositions
    cleaned = cleaned.replace(/\b(with|and|or|in|on|at|for)\s*$/i, '').trim();

    // Handle "text - subtitle" pattern
    const dashSplit = cleaned.split(/–|—|-/).map((s) => s.trim()).filter(Boolean);
    if (dashSplit.length >= 2) {
      result.text = dashSplit[0];
      result.subtitle = dashSplit.slice(1).join(' - ');
    } else {
      result.text = cleaned;
    }

    // Use style override if present in prompt
    const styleWord = Object.keys(styleMap).find((key) => lower.includes(key) && key !== matchedId.replace('lt-', '').replace('title-', '').replace('callout-', '').replace('social-', '').replace('brand-', ''));
    if (styleWord) {
      result.style = styleMap[styleWord];
    }
  } else {
    // No template matched — extract basic text
    let cleaned = trimmed
      .replace(/\b(add|show|display|put|place|insert|create|make|render)\b/gi, '')
      .replace(/\b(a|an|the|that|with|using|in|at|for|on|from|to)\b/gi, '')
      .replace(/\b(says?|saying|called|named|titled|entitled)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    cleaned = cleaned.replace(/(at|from|starting at|start)\s+\d+(\.\d+)?/gi, '');
    cleaned = cleaned.replace(/(to|until|end|ending at)\s+\d+(\.\d+)?/gi, '');

    const dashSplit = cleaned.split(/–|—|-/).map((s) => s.trim()).filter(Boolean);
    if (dashSplit.length >= 2) {
      result.text = dashSplit[0];
      result.subtitle = dashSplit.slice(1).join(' - ');
    } else {
      result.text = cleaned;
    }

    // Determine best template category from context
    const lower = trimmed.toLowerCase();
    if (lower.includes('lower third') || lower.includes('lower-third')) {
      result.template = 'lt-clean';
    } else if (lower.includes('title') || lower.includes('heading') || lower.includes('headline')) {
      result.template = 'title-center';
    } else if (lower.includes('quote') || lower.includes('said') || lower.includes('says')) {
      result.template = 'callout-quote';
    } else if (lower.includes('social') || lower.includes('handle') || lower.includes('@')) {
      result.template = 'social-tag';
    } else if (lower.includes('subscribe') || lower.includes('follow')) {
      result.template = 'social-subscribe';
    } else if (lower.includes('watermark')) {
      result.template = 'brand-watermark';
    }
  }

  // Clean up final text
  result.text = result.text
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—,;:]+|[\s\-–—,;:]+$/g, '')
    .trim();

  if (result.subtitle) {
    result.subtitle = result.subtitle
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–—,;:]+|[\s\-–—,;:]+$/g, '')
      .trim();
  }

  return result;
}

export function formatMotionCommand(parsed: ParsedMotionCommand): string {
  let parts = [`Template: ${parsed.template}`];
  parts.push(`Text: "${parsed.text}"`);
  if (parsed.subtitle) parts.push(`Subtitle: "${parsed.subtitle}"`);
  if (parsed.startTime !== undefined) parts.push(`Start: ${parsed.startTime}s`);
  if (parsed.endTime !== undefined) parts.push(`End: ${parsed.endTime}s`);
  if (parsed.style) parts.push(`Style override: ${parsed.style}`);
  return parts.join(' | ');
}
