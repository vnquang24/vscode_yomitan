import kuromoji, { type IpadicFeatures, type Tokenizer } from 'kuromoji';
import { katakanaToHiragana } from './kana.js';
import { extractContextAtOffset, type ExtractedJapaneseContext } from './textExtractor.js';

export interface AnalyzedPosition {
  context: ExtractedJapaneseContext;
  /** Ordered candidate scan strings (snapped to compound/token start first, then raw cursor) */
  lookupCandidates: string[];
  /** Surface form of morphological token (or joined noun compound) under cursor */
  tokenSurface: string;
  /** Dictionary base form from kuromoji (e.g. 食べる for 食べた) */
  tokenBaseForm: string;
  /** Hiragana reading of the token/compound under cursor */
  tokenReadingHiragana: string;
  /** Hiragana reading of the entire sentence */
  sentenceReadingHiragana: string;
}

function isCompoundableNoun(token: IpadicFeatures): boolean {
  if (token.pos !== '名詞') return false;
  if (['非自立', '代名詞', '数'].includes(token.pos_detail_1)) return false;
  return true;
}

export class JapaneseAnalyzer {
  private tokenizer: Tokenizer<IpadicFeatures> | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly dicPath: string) {}

  async init(): Promise<void> {
    if (this.tokenizer) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<void>((resolve, reject) => {
      kuromoji.builder({ dicPath: this.dicPath }).build((err, tokenizer) => {
        if (err) {
          this.initPromise = null;
          reject(err);
          return;
        }
        this.tokenizer = tokenizer;
        resolve();
      });
    });

    return this.initPromise;
  }

  isReady(): boolean {
    return this.tokenizer !== null;
  }

  tokenize(text: string): IpadicFeatures[] {
    if (!this.tokenizer) {
      throw new Error('JapaneseAnalyzer chưa được khởi tạo (init).');
    }
    return this.tokenizer.tokenize(text);
  }

  toHiraganaReading(text: string): string {
    if (!this.tokenizer) return text;
    const tokens = this.tokenizer.tokenize(text);
    return tokens
      .map((t) => (t.reading && t.reading !== '*' ? katakanaToHiragana(t.reading) : t.surface_form))
      .join('');
  }

  async analyzeAtOffset(lineText: string, columnOffset: number): Promise<AnalyzedPosition | null> {
    const context = extractContextAtOffset(lineText, columnOffset);
    if (!context) return null;

    await this.init();
    const tokens = this.tokenize(context.clause);

    let cursorTokenIndex = -1;
    const spans: Array<{ start: number; end: number; token: IpadicFeatures }> = [];
    let runningOffset = 0;

    for (let i = 0; i < tokens.length; i++) {
      const surface = tokens[i].surface_form;
      const start = runningOffset;
      const end = start + surface.length;
      spans.push({ start, end, token: tokens[i] });
      if (context.offsetInClause >= start && context.offsetInClause < end) {
        cursorTokenIndex = i;
      }
      runningOffset = end;
    }

    const candidates: string[] = [];
    const addCandidate = (s: string) => {
      const trimmed = s.trim();
      if (trimmed && !candidates.includes(trimmed)) {
        candidates.push(trimmed);
      }
    };

    let tokenSurface = context.scanFromCursor.slice(0, 1);
    let tokenBaseForm = tokenSurface;
    let tokenReadingHiragana = '';

    if (cursorTokenIndex !== -1) {
      const target = spans[cursorTokenIndex];
      tokenSurface = target.token.surface_form;
      tokenBaseForm =
        target.token.basic_form && target.token.basic_form !== '*'
          ? target.token.basic_form
          : tokenSurface;

      // 1. If hovering an auxiliary / verb suffix (e.g. られ in 食べさせられた), walk back to governing verb/adjective!
      if (
        target.token.pos === '助動詞' ||
        (target.token.pos === '動詞' && target.token.pos_detail_1 === '接尾') ||
        (target.token.pos === '助詞' && target.token.pos_detail_1 === '接続助詞')
      ) {
        let headIdx = cursorTokenIndex;
        while (
          headIdx > 0 &&
          ['動詞', '形容詞', '助動詞', '助詞'].includes(spans[headIdx - 1].token.pos)
        ) {
          headIdx--;
          if (
            (spans[headIdx].token.pos === '動詞' || spans[headIdx].token.pos === '形容詞') &&
            spans[headIdx].token.pos_detail_1 === '自立'
          ) {
            // Include preceding noun ONLY when verb is する (e.g. 実装 + さ + れ -> 実装され...)
            if (
              spans[headIdx].token.basic_form === 'する' &&
              headIdx > 0 &&
              isCompoundableNoun(spans[headIdx - 1].token)
            ) {
              headIdx--;
            }
            break;
          }
        }
        if (headIdx < cursorTokenIndex) {
          addCandidate(context.clause.slice(spans[headIdx].start, spans[headIdx].start + 28));
        }
      }

      // 2. Join adjacent content nouns (Kanji + Kanji or Kanji + Katakana like 単体テスト / データベース接続)
      let compoundStartIdx = cursorTokenIndex;
      let compoundEndIdx = cursorTokenIndex;
      if (isCompoundableNoun(target.token)) {
        while (compoundStartIdx > 0 && isCompoundableNoun(spans[compoundStartIdx - 1].token)) {
          compoundStartIdx--;
        }
        while (
          compoundEndIdx + 1 < spans.length &&
          isCompoundableNoun(spans[compoundEndIdx + 1].token)
        ) {
          compoundEndIdx++;
        }
      }

      // Offer full noun compound FIRST so hovering 報 in 認証情報 or テ in 単体テスト ranks full compound #1!
      if (compoundStartIdx < cursorTokenIndex) {
        addCandidate(context.clause.slice(spans[compoundStartIdx].start, spans[compoundStartIdx].start + 28));
      }

      // Candidate starting at hovered token
      addCandidate(context.clause.slice(target.start, target.start + 28));

      const readingParts: string[] = [];
      const surfaceParts: string[] = [];
      for (let i = compoundStartIdx; i <= compoundEndIdx; i++) {
        const tk = spans[i].token;
        surfaceParts.push(tk.surface_form);
        readingParts.push(
          tk.reading && tk.reading !== '*' ? katakanaToHiragana(tk.reading) : tk.surface_form
        );
      }
      if (compoundStartIdx < compoundEndIdx) {
        tokenSurface = surfaceParts.join('');
      }
      tokenReadingHiragana = readingParts.join('');

      if (tokenBaseForm !== target.token.surface_form) {
        addCandidate(tokenBaseForm);
      }
    }

    addCandidate(context.scanFromCursor);

    const sentenceReadingHiragana = this.toHiraganaReading(context.sentence);

    return {
      context,
      lookupCandidates: candidates,
      tokenSurface,
      tokenBaseForm,
      tokenReadingHiragana,
      sentenceReadingHiragana
    };
  }
}
