import { containsJapanese, isJapaneseChar } from './kana.js';

export interface ExtractedJapaneseContext {
  /** Substring starting directly at cursor up to maxScanLength */
  scanFromCursor: string;
  /** Contiguous Japanese clause containing cursor */
  clause: string;
  /** Offset of cursor inside `clause` */
  offsetInClause: number;
  /** Clean Japanese sentence around cursor (comment markers & string quotes stripped) */
  sentence: string;
}

const SENTENCE_STOP_CHARS = new Set(['。', '！', '？', '!', '?', '\n', '\r']);
const QUOTE_OR_BRACKET_BOUNDARIES = new Set([
  '"',
  "'",
  '`',
  '<',
  '>',
  '{',
  '}',
  '[',
  ']',
  '|',
  ';'
]);

export function extractContextAtOffset(
  lineText: string,
  columnOffset: number,
  maxScanLength = 28
): ExtractedJapaneseContext | null {
  if (columnOffset < 0 || columnOffset >= lineText.length) {
    return null;
  }

  const ch = lineText[columnOffset];
  if (!isJapaneseChar(ch) || '、。「」『』（）・　 '.includes(ch)) {
    return null;
  }
  if (!containsJapanese(ch)) {
    return null;
  }

  // 1. Expand left within contiguous clause
  let clauseStart = columnOffset;
  while (clauseStart > 0) {
    const prev = lineText[clauseStart - 1];
    if (QUOTE_OR_BRACKET_BOUNDARIES.has(prev) || prev === '/' || prev === '*') {
      break;
    }
    if (prev === '#' && (clauseStart === 1 || /\s/.test(lineText[clauseStart - 2]))) {
      break;
    }
    if (!isJapaneseChar(prev) && !/[0-9A-Za-z_.\- 　]/.test(prev)) {
      break;
    }
    if (/[A-Za-z]/.test(prev) && !containsJapanese(lineText.slice(0, clauseStart))) {
      break;
    }
    if (SENTENCE_STOP_CHARS.has(prev)) {
      break;
    }
    clauseStart--;
  }

  // 2. Expand right within contiguous clause
  let clauseEnd = columnOffset + 1;
  while (clauseEnd < lineText.length) {
    const next = lineText[clauseEnd];
    if (QUOTE_OR_BRACKET_BOUNDARIES.has(next)) {
      break;
    }
    if (next === '*' && lineText[clauseEnd + 1] === '/') {
      break;
    }
    if (next === '/' && lineText[clauseEnd + 1] === '/') {
      break;
    }
    if (next === '#' && /\s/.test(lineText[clauseEnd - 1])) {
      break;
    }
    if (SENTENCE_STOP_CHARS.has(next)) {
      if ('。！？'.includes(next)) {
        clauseEnd++;
      }
      break;
    }
    clauseEnd++;
  }

  const rawClause = lineText.slice(clauseStart, clauseEnd);
  const sentence = cleanCodeArtifacts(rawClause);
  if (!containsJapanese(sentence)) {
    return null;
  }

  const scanEnd = Math.min(clauseEnd, columnOffset + maxScanLength);
  const scanFromCursor = lineText.slice(columnOffset, scanEnd);

  return {
    scanFromCursor,
    clause: rawClause,
    offsetInClause: columnOffset - clauseStart,
    sentence
  };
}

export function cleanCodeArtifacts(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:\/\/+|\/\*+|\*+|#+|--+|<!--)\s*/, '')
        .replace(/\s*(?:\*+\/|-->)\s*$/, '')
        .replace(/^[\s"'`,;|]+/, '')
        .replace(/[\s"'`,;|]+$/, '')
        .trim()
    )
    .filter(Boolean)
    .join('\n')
    .trim();
}
