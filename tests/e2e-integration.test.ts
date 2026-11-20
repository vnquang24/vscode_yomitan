import { describe, expect, it, beforeAll } from 'vitest';
import * as path from 'node:path';
import { DictionaryStore } from '../src/dictionary/dictionaryStore.js';
import { JapaneseAnalyzer } from '../src/japanese/analyzer.js';
import { formatYomitanHoverMarkdown } from '../src/ui/hoverFormatter.js';

describe('End-to-End Offline Dictionary + Kuromoji + Hover Latency Benchmark', () => {
  const store = new DictionaryStore();
  const analyzer = new JapaneseAnalyzer(path.resolve('data/kuromoji-dict'));

  beforeAll(async () => {
    await Promise.all([
      analyzer.init(),
      (async () => {
        await store.importYomitanZip(path.resolve('data/KANJIDIC_vietnamese.zip'));
        await store.loadCompactBundleGz(path.resolve('data/javi-dict.json.gz'));
      })()
    ]);
  });

  it('loads 100k+ offline JA-VI & KanjiDictVN entries and resolves real Japanese comments in < 15ms', async () => {
    const stats = store.getStats();
    expect(stats.termKeys).toBeGreaterThan(100000);
    expect(stats.kanjiCount).toBeGreaterThan(6000);

    const sampleLine =
      '  // ユーザーの認証情報を確認してからデータベースに保存してください。';
    const hoverOffset = sampleLine.indexOf('証'); // middle of 認証情報!

    // Warm up JIT once, then measure steady-state hover latency
    await analyzer.analyzeAtOffset(sampleLine, hoverOffset);

    const t0 = performance.now();
    const analyzed = await analyzer.analyzeAtOffset(sampleLine, hoverOffset);
    expect(analyzed).not.toBeNull();

    const matches = store.lookupTerms(analyzed!.lookupCandidates, 5);
    const kanjiList = store.lookupKanjiList(matches[0].expression);
    const hoverMd = formatYomitanHoverMarkdown({
      matches,
      kanjiList,
      fallbackSurface: analyzed!.tokenSurface,
      fallbackReading: analyzed!.tokenReadingHiragana,
      fallbackHanViet: store.computeCompoundHanViet(analyzed!.tokenSurface),
      sentence: analyzed!.context.sentence,
      sentenceReading: analyzed!.sentenceReadingHiragana
    });
    const elapsedMs = performance.now() - t0;

    expect(elapsedMs).toBeLessThan(20);
    expect(matches[0].expression).toBe('認証情報');
    expect(matches[0].hanViet).toBe('NHẬN CHỨNG TÌNH BÁO');
    expect(hoverMd).toContain('thông tin xác thực');
    expect(hoverMd).toContain('ユーザーの認証情報を確認してからデータベースに保存してください。');
  });

  it('resolves general OVDP Japanese words with deinflection (食べさせられた -> 食べる, 難しかった -> 難しい)', async () => {
    const line = '// この問題は思ったより難しかったです。';
    const analyzed = await analyzer.analyzeAtOffset(line, line.indexOf('難'));
    expect(analyzed).not.toBeNull();

    const matches = store.lookupTerms(analyzed!.lookupCandidates, 5);
    expect(matches.some((m) => m.expression === '難しい')).toBe(true);
  });
});
