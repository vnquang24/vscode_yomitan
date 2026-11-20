import { describe, expect, it, beforeAll } from 'vitest';
import * as path from 'node:path';
import {
  katakanaToHiragana,
  containsJapanese,
  isKanji,
  extractKanjiChars
} from '../src/japanese/kana.js';
import { extractContextAtOffset } from '../src/japanese/textExtractor.js';
import { deinflect } from '../src/japanese/deinflector.js';
import { JapaneseAnalyzer } from '../src/japanese/analyzer.js';

describe('kana utilities', () => {
  it('converts katakana readings from kuromoji into hiragana', () => {
    expect(katakanaToHiragana('ニンショウジョウホウ')).toBe('にんしょうじょうほう');
    expect(katakanaToHiragana('トウキョウ')).toBe('とうきょう');
  });

  it('detects Japanese characters and extracts unique Kanji in order', () => {
    expect(containsJapanese('const total = 42;')).toBe(false);
    expect(containsJapanese('// 認証エラー')).toBe(true);
    expect(isKanji('認')).toBe(true);
    expect(isKanji('あ')).toBe(false);
    expect(isKanji('ア')).toBe(false);
    expect(extractKanjiChars('認証エラーが発生しました（再認証）')).toEqual(['認', '証', '発', '生', '再']);
  });
});

describe('extractContextAtOffset', () => {
  it('returns null when hovering over non-Japanese code tokens on the same line', () => {
    const line = 'const token = getAuth(); // 認証トークンを取得する';
    expect(extractContextAtOffset(line, 6)).toBeNull();
  });

  it('extracts clean sentence without code comment markers and delimits by Japanese punctuation', () => {
    const line = '  // ユーザーの認証情報を確認してください。次の処理へ進みます';
    const targetIdx = line.indexOf('証');
    const ctx = extractContextAtOffset(line, targetIdx);

    expect(ctx).not.toBeNull();
    expect(ctx!.scanFromCursor.startsWith('証情報を確認')).toBe(true);
    expect(ctx!.sentence).toBe('ユーザーの認証情報を確認してください。');
  });

  it('strips JSON/string quotes cleanly around Japanese error messages', () => {
    const line = '  "message": "データベース接続に失敗しました",';
    const targetIdx = line.indexOf('接');
    const ctx = extractContextAtOffset(line, targetIdx);

    expect(ctx).not.toBeNull();
    expect(ctx!.sentence).toBe('データベース接続に失敗しました');
  });

  it('stops clause extraction at Markdown table pipes | and cleans multi-line comment prefixes', () => {
    const tableLine = '| 項目 | 認証情報を確認 | 備考 |';
    const ctx = extractContextAtOffset(tableLine, tableLine.indexOf('認'));
    expect(ctx).not.toBeNull();
    expect(ctx!.sentence).toBe('認証情報を確認');
  });
});

describe('deinflect (Yomitan-style Japanese verb/adjective deinflection)', () => {
  it('deinflects complex ichidan causative-passive past: 食べさせられた -> 食べる', () => {
    const results = deinflect('食べさせられた');
    const match = results.find((r) => r.term === '食べる');
    expect(match).toBeDefined();
    expect(match!.reasons.length).toBeGreaterThan(0);
  });

  it('deinflects suru-verb passive progressive polite negative: 実装されていません -> 実装する & 実装', () => {
    const results = deinflect('実装されていません');
    const terms = results.map((r) => r.term);
    expect(terms).toContain('実装する');
    expect(terms).toContain('実装');
  });

  it('deinflects godan past negative & te-ita forms: 書かなかった -> 書く, 読んでいた -> 読む', () => {
    expect(deinflect('書かなかった').map((r) => r.term)).toContain('書く');
    expect(deinflect('読んでいた').map((r) => r.term)).toContain('読む');
  });

  it('deinflects i-adjective negative and past forms: 高くない -> 高い, 難しかった -> 難しい', () => {
    expect(deinflect('高くない').map((r) => r.term)).toContain('高い');
    expect(deinflect('難しかった').map((r) => r.term)).toContain('難しい');
  });

  it('does not produce 0-length stem false positives (して -x-> す, 買った -x-> い) or strip further after する -> noun', () => {
    expect(deinflect('して').map((r) => r.term)).not.toContain('す');
    expect(deinflect('買った').map((r) => r.term)).not.toContain('い');
    // 愛する -> 愛 (noun), NOT stripping い/etc further
    expect(deinflect('愛していない').map((r) => r.term)).toContain('愛');
  });
});

describe('JapaneseAnalyzer (kuromoji morphological boundary & kana reading)', () => {
  let analyzer: JapaneseAnalyzer;

  beforeAll(async () => {
    const dicPath = path.resolve('node_modules/kuromoji/dict');
    analyzer = new JapaneseAnalyzer(dicPath);
    await analyzer.init();
  });

  it('snaps to compound word start when cursor hovers on middle Kanji (証 inside 認証情報)', async () => {
    const line = '// ユーザーの認証情報を確認する';
    const idx = line.indexOf('証');
    const res = await analyzer.analyzeAtOffset(line, idx);

    expect(res).not.toBeNull();
    expect(res!.lookupCandidates[0].startsWith('認証情報')).toBe(true);
    expect(res!.tokenReadingHiragana).toContain('にんしょう');
  });

  it('joins mixed Kanji+Katakana compounds (単体テスト) and snaps auxiliary hover (られ in 食べさせられた) to verb start', async () => {
    const itLine = '// 単体テストを実行する';
    const katakanaHover = await analyzer.analyzeAtOffset(itLine, itLine.indexOf('テ'));
    expect(katakanaHover).not.toBeNull();
    expect(katakanaHover!.lookupCandidates[0].startsWith('単体テスト')).toBe(true);

    const verbLine = '// 全部食べさせられた';
    const auxHover = await analyzer.analyzeAtOffset(verbLine, verbLine.indexOf('ら'));
    expect(auxHover).not.toBeNull();
    expect(auxHover!.lookupCandidates[0].startsWith('食べさせられた')).toBe(true);
  });
});
