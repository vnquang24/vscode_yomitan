import kuromoji, { type IpadicFeatures, type Tokenizer } from 'kuromoji';
import { isKanji, katakanaToHiragana } from './kana.js';
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

    // Map each token's start & end offset within context.clause
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

      // Join adjacent Kanji noun compounds (e.g. 認証 + 情報 -> 認証情報) around cursor
      let compoundStartIdx = cursorTokenIndex;
      while (
        compoundStartIdx > 0 &&
        spans[compoundStartIdx].token.pos === '名詞' &&
        spans[compoundStartIdx - 1].token.pos === '名詞' &&
        isKanji(spans[compoundStartIdx].token.surface_form[0]) &&
        isKanji(spans[compoundStartIdx - 1].token.surface_form.slice(-1))
      ) {
        compoundStartIdx--;
      }

      let compoundEndIdx = cursorTokenIndex;
      while (
        compoundEndIdx + 1 < spans.length &&
        spans[compoundEndIdx].token.pos === '名詞' &&
        spans[compoundEndIdx + 1].token.pos === '名詞' &&
        isKanji(spans[compoundEndIdx + 1].token.surface_form[0])
      ) {
        compoundEndIdx++;
      }

      // 1. Candidate starting from token containing cursor (handles hovering 証 inside 認証情報 -> 認証情報...)
      addCandidate(context.clause.slice(target.start, target.start + 28));

      // 2. If cursor was on second half of a Kanji noun compound (e.g. 報 inside 認証情報), also offer full compound!
      if (compoundStartIdx < cursorTokenIndex) {
        addCandidate(context.clause.slice(spans[compoundStartIdx].start, spans[compoundStartIdx].start + 28));
      }

      // Compute combined Hiragana reading for the compound / token
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

      // 3. Also add basic_form from kuromoji if different
      if (tokenBaseForm !== target.token.surface_form) {
        addCandidate(tokenBaseForm);
      }
    }

    // 4. Raw slice starting directly at cursor
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
