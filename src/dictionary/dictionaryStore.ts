import * as fs from 'node:fs/promises';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';
import { deinflect } from '../japanese/deinflector.js';
import { extractKanjiChars } from '../japanese/kana.js';
import {
  parseYomitanZip,
  type KanjiEntry,
  type TermEntry
} from './yomitanLoader.js';

const gunzipAsync = promisify(zlib.gunzip);

export interface CompactDictionaryBundle {
  title: string;
  /** Compact tuples: [expression, reading, glosses[], score?, hanViet?] */
  terms: Array<[string, string, string[], number?, string?]>;
  kanji?: Array<[string, string, string, string, string[]]>;
}

export interface LookupMatch {
  expression: string;
  reading: string;
  hanViet: string;
  glosses: string[];
  posTags: string;
  dictionary: string;
  matchedSurface: string;
  deinflectReasons: string[];
  score: number;
}

export class DictionaryStore {
  private readonly termsByKey = new Map<string, TermEntry[]>();
  private readonly kanjiByChar = new Map<string, KanjiEntry>();
  private readonly loadedDictionaries: string[] = [];

  getLoadedDictionaries(): string[] {
    return [...this.loadedDictionaries];
  }

  getStats(): { termKeys: number; kanjiCount: number; dictionaries: string[] } {
    return {
      termKeys: this.termsByKey.size,
      kanjiCount: this.kanjiByChar.size,
      dictionaries: this.getLoadedDictionaries()
    };
  }

  addTerm(entry: TermEntry): void {
    this.pushTermKey(entry.expression, entry);
    if (entry.reading && entry.reading !== entry.expression) {
      this.pushTermKey(entry.reading, entry);
    }
  }

  private pushTermKey(key: string, entry: TermEntry): void {
    const existing = this.termsByKey.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      this.termsByKey.set(key, [entry]);
    }
  }

  addKanji(entry: KanjiEntry): void {
    const prev = this.kanjiByChar.get(entry.character);
    if (!prev) {
      this.kanjiByChar.set(entry.character, entry);
      return;
    }
    // Merge Hán-Việt & meanings if enriched from multiple sources
    this.kanjiByChar.set(entry.character, {
      ...prev,
      hanViet: prev.hanViet || entry.hanViet,
      onyomi: prev.onyomi || entry.onyomi,
      kunyomi: prev.kunyomi || entry.kunyomi,
      meanings: prev.meanings.length > 0 ? prev.meanings : entry.meanings
    });
  }

  async importYomitanZip(zipInput: Buffer | Uint8Array | string): Promise<string> {
    const parsed = await parseYomitanZip(zipInput);
    for (const k of parsed.kanji) {
      this.addKanji(k);
    }
    for (const t of parsed.terms) {
      this.addTerm(t);
    }
    if (!this.loadedDictionaries.includes(parsed.title)) {
      this.loadedDictionaries.push(parsed.title);
    }
    return parsed.title;
  }

  async loadCompactBundleGz(gzInput: Buffer | string): Promise<string> {
    const rawGz =
      typeof gzInput === 'string' ? await fs.readFile(gzInput) : gzInput;
    const jsonBytes = await gunzipAsync(rawGz);
    const bundle = JSON.parse(jsonBytes.toString('utf8')) as CompactDictionaryBundle;

    if (bundle.kanji) {
      for (const [character, hanViet, onyomi, kunyomi, meanings] of bundle.kanji) {
        this.addKanji({
          character,
          hanViet,
          onyomi,
          kunyomi,
          meanings,
          tags: '',
          dictionary: bundle.title
        });
      }
    }

    for (const [expression, reading, glosses, score, hanViet] of bundle.terms) {
      this.addTerm({
        expression,
        reading: reading || expression,
        posTags: '',
        rules: '',
        score: score ?? 50,
        glosses,
        hanViet,
        dictionary: bundle.title
      });
    }

    if (!this.loadedDictionaries.includes(bundle.title)) {
      this.loadedDictionaries.push(bundle.title);
    }
    return bundle.title;
  }

  computeCompoundHanViet(text: string): string {
    const kanjis = extractKanjiChars(text);
    if (kanjis.length === 0) return '';

    // Map each character in `text` (preserving repeated Kanji like 人々 or 正々堂々)
    const parts: string[] = [];
    let prevKanji = '';
    for (const ch of text) {
      const targetChar = ch === '々' && prevKanji ? prevKanji : ch;
      const kEntry = this.kanjiByChar.get(targetChar);
      if (kEntry && kEntry.hanViet) {
        const primaryHv = kEntry.hanViet.split(/[,;/]/)[0].trim();
        if (primaryHv) {
          parts.push(primaryHv);
        }
        prevKanji = targetChar;
      } else {
        prevKanji = '';
      }
    }
    return parts.join(' ');
  }

  lookupTerms(
    scanCandidates: string[],
    maxResults = 6,
    maxPrefixLen = 20
  ): LookupMatch[] {
    const results: LookupMatch[] = [];
    const seenKey = new Set<string>();

    for (let candIdx = 0; candIdx < scanCandidates.length; candIdx++) {
      const candidate = scanCandidates[candIdx];
      if (!candidate) continue;

      const upperLen = Math.min(candidate.length, maxPrefixLen);
      for (let len = upperLen; len >= 1; len--) {
        const surface = candidate.slice(0, len);
        const deinflections = deinflect(surface);

        for (const df of deinflections) {
          const entries = this.termsByKey.get(df.term);
          if (!entries) continue;

          for (const entry of entries) {
            // Avoid spurious reading-only collision when surface is pure hiragana of length 1
            if (
              surface.length === 1 &&
              entry.expression !== df.term &&
              entry.reading === df.term
            ) {
              continue;
            }

            const dedupId = `${entry.expression}|${entry.reading}|${entry.dictionary}`;
            if (seenKey.has(dedupId)) continue;
            seenKey.add(dedupId);

            const hanViet =
              entry.hanViet || this.computeCompoundHanViet(entry.expression);

            results.push({
              expression: entry.expression,
              reading: entry.reading,
              hanViet,
              glosses: entry.glosses,
              posTags: entry.posTags,
              dictionary: entry.dictionary,
              matchedSurface: surface,
              deinflectReasons: df.reasons,
              // Prioritize earlier candidate (compound boundary) slightly, but longest matched surface first
              score:
                surface.length * 1000 -
                candIdx * 50 -
                df.reasons.length * 10 +
                entry.score
            });
          }
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  lookupKanjiList(text: string): KanjiEntry[] {
    const chars = extractKanjiChars(text);
    const out: KanjiEntry[] = [];
    for (const ch of chars) {
      const k = this.kanjiByChar.get(ch);
      if (k) {
        out.push(k);
      }
    }
    return out;
  }
}
