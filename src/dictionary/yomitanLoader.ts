import * as fs from 'node:fs/promises';
import JSZip from 'jszip';

export interface TermEntry {
  expression: string;
  reading: string;
  posTags: string;
  rules: string;
  score: number;
  glosses: string[];
  dictionary: string;
  hanViet?: string;
}

export interface KanjiEntry {
  character: string;
  onyomi: string;
  kunyomi: string;
  hanViet: string;
  meanings: string[];
  tags: string;
  dictionary: string;
}

export interface ParsedYomitanDictionary {
  title: string;
  terms: TermEntry[];
  kanji: KanjiEntry[];
}

const BLOCK_TAGS = new Set(['div', 'p', 'li', 'ul', 'ol', 'tr', 'table', 'section', 'details']);
const IGNORED_TAGS = new Set(['rt', 'rp']);

export function extractGlossaryText(item: unknown): string {
  if (typeof item === 'string') {
    return item.trim();
  }
  if (!item || typeof item !== 'object') {
    return '';
  }

  const obj = item as Record<string, unknown>;
  if (obj.type === 'image') {
    return '';
  }
  if (obj.type === 'text' && typeof obj.text === 'string') {
    return obj.text.trim();
  }
  if (obj.type === 'structured-content') {
    return renderStructuredNode(obj.content)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  if ('content' in obj) {
    return renderStructuredNode(obj.content).trim();
  }
  return '';
}

function renderStructuredNode(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => renderStructuredNode(child)).join('');
  }
  if (typeof node === 'object') {
    const el = node as Record<string, unknown>;
    const tag = typeof el.tag === 'string' ? el.tag.toLowerCase() : '';
    if (IGNORED_TAGS.has(tag)) {
      return '';
    }
    if (tag === 'br') {
      return '\n';
    }
    const inner = renderStructuredNode(el.content);
    if (!inner) return '';
    if (tag === 'li') {
      return `• ${inner.trim()}\n`;
    }
    if (BLOCK_TAGS.has(tag)) {
      return `${inner.trim()}\n`;
    }
    return inner;
  }
  return '';
}

function extractHanVietFromMeanings(
  meanings: string[],
  onyomi: string,
  kunyomi: string
): {
  hanViet: string;
  normalizedOnyomi: string;
  restMeanings: string[];
} {
  let primaryBracketHv = '';
  let explicitUpperHv = '';
  const restMeanings: string[] = [];

  for (const m of meanings) {
    const trimmed = m.trim();
    if (!trimmed) continue;

    // Match explicit uppercase Sino-Vietnamese token(s) like "NHẬN" or "THỰC, THỊ"
    if (
      !explicitUpperHv &&
      trimmed.length <= 30 &&
      trimmed === trimmed.toUpperCase() &&
      /\p{L}/u.test(trimmed) &&
      !/^[A-Z]{2,}\s+[A-Z]{2,}\s+[A-Z]{2,}/.test(trimmed)
    ) {
      explicitUpperHv = trimmed;
      continue;
    }

    // Match bracketed Hán-Việt prefix like "[á] thứ hai" or "【THỰC】 thực tế..."
    const bracketMatch = trimmed.match(/^[【\[]([^】\]]+)[】\]]\s*(.*)$/);
    if (bracketMatch) {
      if (!primaryBracketHv) {
        primaryBracketHv = bracketMatch[1].trim().toUpperCase();
      }
      restMeanings.push(trimmed);
      continue;
    }

    restMeanings.push(trimmed);
  }

  let normalizedOnyomi = onyomi;
  let latinHvList: string[] = [];

  // KanjiDictVN stores Vietnamese Latin readings (with full diacritics like đ, ệ, ứ) in row[1] (onyomi)
  if (onyomi && /^[\p{Script=Latin}\s,;/]+$/u.test(onyomi)) {
    latinHvList = onyomi
      .split(/[\s,;/]+/)
      .filter(Boolean)
      .map((s) => s.toUpperCase());
    normalizedOnyomi = '';
  } else if (!explicitUpperHv && !primaryBracketHv && kunyomi && /^[\p{Script=Latin}\s,;/]+$/u.test(kunyomi)) {
    latinHvList = kunyomi
      .split(/[\s,;/]+/)
      .filter(Boolean)
      .map((s) => s.toUpperCase());
  }

  let hanViet = explicitUpperHv;
  if (!hanViet && latinHvList.length > 0) {
    // Put primaryBracketHv (most common reading from first gloss) first!
    if (primaryBracketHv && latinHvList.includes(primaryBracketHv)) {
      latinHvList = [
        primaryBracketHv,
        ...latinHvList.filter((item) => item !== primaryBracketHv)
      ];
    }
    hanViet = Array.from(new Set(latinHvList)).join(', ');
  }
  if (!hanViet && primaryBracketHv) {
    hanViet = primaryBracketHv;
    // Strip bracket from single bracketed gloss if it was the sole Hán-Việt carrier
    for (let i = 0; i < restMeanings.length; i++) {
      restMeanings[i] = restMeanings[i].replace(/^[【\[][^】\]]+[】\]]\s*/, '');
    }
  }

  return {
    hanViet,
    normalizedOnyomi,
    restMeanings: restMeanings.length > 0 ? restMeanings : meanings
  };
}

export async function parseYomitanZip(
  zipInput: Buffer | Uint8Array | string
): Promise<ParsedYomitanDictionary> {
  const data =
    typeof zipInput === 'string' ? await fs.readFile(zipInput) : zipInput;
  const zip = await JSZip.loadAsync(data);

  let title = 'Yomitan Dictionary';
  const indexFile = zip.file('index.json');
  if (indexFile) {
    const indexJson = JSON.parse(await indexFile.async('string')) as {
      title?: string;
    };
    if (indexJson.title) {
      title = indexJson.title;
    }
  }

  const terms: TermEntry[] = [];
  const kanji: KanjiEntry[] = [];

  const fileNames = Object.keys(zip.files).sort();

  for (const name of fileNames) {
    const baseName = name.split('/').pop() ?? name;
    if (/^term_bank_\d+\.json$/.test(baseName)) {
      const raw = await zip.files[name].async('string');
      const rows = JSON.parse(raw) as unknown[][];
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 6) continue;
        const expression = String(row[0] ?? '').trim();
        const reading = String(row[1] ?? '').trim();
        const posTags = String(row[2] ?? '').trim();
        const rules = String(row[3] ?? '').trim();
        const score = typeof row[4] === 'number' ? row[4] : 0;
        const rawGlosses = Array.isArray(row[5]) ? row[5] : [row[5]];
        const glosses = rawGlosses
          .map((g) => extractGlossaryText(g))
          .filter((g) => g.length > 0);

        if (expression && glosses.length > 0) {
          terms.push({
            expression,
            reading: reading || expression,
            posTags,
            rules,
            score,
            glosses,
            dictionary: title
          });
        }
      }
    } else if (/^kanji_bank_\d+\.json$/.test(baseName)) {
      const raw = await zip.files[name].async('string');
      const rows = JSON.parse(raw) as unknown[][];
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 5) continue;
        const character = String(row[0] ?? '').trim();
        const onyomi = String(row[1] ?? '').trim();
        const kunyomi = String(row[2] ?? '').trim();
        const tags = String(row[3] ?? '').trim();
        const rawMeanings = Array.isArray(row[4])
          ? row[4].map((m) => String(m))
          : [];

        if (!character) continue;
        const { hanViet, normalizedOnyomi, restMeanings } =
          extractHanVietFromMeanings(rawMeanings, onyomi, kunyomi);

        kanji.push({
          character,
          onyomi: normalizedOnyomi,
          kunyomi,
          hanViet,
          meanings: restMeanings,
          tags,
          dictionary: title
        });
      }
    }
  }

  return { title, terms, kanji };
}
