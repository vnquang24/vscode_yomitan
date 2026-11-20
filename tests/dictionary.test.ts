import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseYomitanZip } from '../src/dictionary/yomitanLoader.js';
import { DictionaryStore } from '../src/dictionary/dictionaryStore.js';

async function buildMockYomitanZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'index.json',
    JSON.stringify({
      title: 'Test Ja-Vi Yomitan Dict',
      format: 3,
      revision: '2026.11'
    })
  );

  // Yomitan v3 term_bank tuple:
  // [expression, reading, defTags, rules, score, glossary, sequence, termTags]
  zip.file(
    'term_bank_1.json',
    JSON.stringify([
      ['認証', 'にんしょう', 'n vs', 'vs', 100, ['xác thực (authentication)'], 1, 'it'],
      [
        '認証情報',
        'にんしょうじょうほう',
        'n',
        '',
        120,
        [
          {
            type: 'structured-content',
            content: [
              { tag: 'div', content: 'thông tin xác thực (credentials)' },
              {
                tag: 'ul',
                content: [
                  { tag: 'li', content: ['tài khoản & ', { tag: 'span', content: 'mật khẩu' }] },
                  { tag: 'ruby', content: ['情報', { tag: 'rt', content: 'じょうほう' }] }
                ]
              }
            ]
          }
        ],
        2,
        'it'
      ],
      ['食べる', 'たべる', 'v1', 'v1', 90, ['ăn; dùng bữa'], 3, ''],
      ['実装', 'じっそう', 'n vs', 'vs', 95, ['triển khai; cài đặt (implementation)'], 4, 'it']
    ])
  );

  // Yomitan v3 kanji_bank tuple:
  // [character, onyomi, kunyomi, tags, meanings, stats]
  zip.file(
    'kanji_bank_1.json',
    JSON.stringify([
      ['認', 'ニン', 'みと.める', 'jlpt-n3', ['NHẬN', 'công nhận, thừa nhận, xác nhận'], {}],
      ['証', 'ショウ', 'あかし', 'jlpt-n3', ['CHỨNG', 'bằng chứng, chứng nhận'], {}],
      ['情', 'ジョウ セイ', 'なさ.け', 'jlpt-n3', ['TÌNH', 'tình cảm, thông tin, thực trạng'], {}],
      ['報', 'ホウ', 'むく.いる', 'jlpt-n3', ['BÁO', 'báo cáo, tin tức, đền đáp'], {}]
    ])
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('parseYomitanZip & DictionaryStore', () => {
  it('parses Yomitan v3 term_bank (including structured-content without [object Object]) and kanji_bank', async () => {
    const zipBuf = await buildMockYomitanZip();
    const parsed = await parseYomitanZip(zipBuf);

    expect(parsed.title).toBe('Test Ja-Vi Yomitan Dict');
    expect(parsed.terms.length).toBe(4);
    expect(parsed.kanji.length).toBe(4);

    const credEntry = parsed.terms.find((t) => t.expression === '認証情報');
    expect(credEntry).toBeDefined();
    expect(credEntry!.glosses.join(' ')).toContain('thông tin xác thực (credentials)');
    expect(credEntry!.glosses.join(' ')).toContain('tài khoản & mật khẩu');
    expect(credEntry!.glosses.join(' ')).not.toContain('[object Object]');
    // rt furigana inside ruby should not pollute base text as 情報じょうほう
    expect(credEntry!.glosses.join(' ')).not.toContain('情報じょうほう');
  });

  it('matches longest prefix first (認証情報 before 認証) and computes compound Hán-Việt', async () => {
    const store = new DictionaryStore();
    await store.importYomitanZip(await buildMockYomitanZip());

    const matches = store.lookupTerms(['認証情報を確認する']);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches[0].expression).toBe('認証情報');
    expect(matches[0].reading).toBe('にんしょうじょうほう');
    expect(matches[0].hanViet).toBe('NHẬN CHỨNG TÌNH BÁO');
    expect(matches[1].expression).toBe('認証');
  });

  it('combines prefix scanning with deinflection (食べさせられた -> 食べる, 実装されていません -> 実装)', async () => {
    const store = new DictionaryStore();
    await store.importYomitanZip(await buildMockYomitanZip());

    const eatMatches = store.lookupTerms(['食べさせられたので']);
    expect(eatMatches[0].expression).toBe('食べる');
    expect(eatMatches[0].matchedSurface).toBe('食べさせられた');
    expect(eatMatches[0].deinflectReasons.length).toBeGreaterThan(0);

    const implMatches = store.lookupTerms(['実装されていません。']);
    expect(implMatches[0].expression).toBe('実装');
    expect(implMatches[0].matchedSurface).toBe('実装されていません');
  });

  it('returns Kanji breakdown entries in character order', async () => {
    const store = new DictionaryStore();
    await store.importYomitanZip(await buildMockYomitanZip());

    const kanjiList = store.lookupKanjiList('認証情報');
    expect(kanjiList.map((k) => k.character)).toEqual(['認', '証', '情', '報']);
    expect(kanjiList[0].hanViet).toBe('NHẬN');
  });

  it('parses real KanjiDictVN format where row[1] holds Vietnamese readings with diacritics (e.g. ัด/ệ/ứ/đ)', async () => {
    const zip = new JSZip();
    zip.file('index.json', JSON.stringify({ title: 'KanjiDictVN', format: 3 }));
    zip.file(
      'kanji_bank_1.json',
      JSON.stringify([
        ['亜', 'a á', '', '', ['[á] thứ hai', '[á] châu Á'], { Strokes: '7' }],
        ['働', 'động', '', '', ['[động] lao động, làm việc'], { Strokes: '13' }],
        ['唖', 'á ách nha', '', '', [], { Strokes: '10' }]
      ])
    );
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const store = new DictionaryStore();
    await store.importYomitanZip(buf);

    const kList = store.lookupKanjiList('亜働唖');
    expect(kList[0].hanViet).toBe('Á, A');
    expect(kList[0].onyomi).toBe('');
    expect(kList[1].hanViet).toBe('ĐỘNG');
    expect(kList[2].hanViet).toBe('Á, ÁCH, NHA');
    expect(store.computeCompoundHanViet('亜働')).toBe('Á ĐỘNG');
  });

  it('parses real Mazii Yomitan format (extracting leading Hán-Việt line and splitting numbered Vietnamese glosses) and Jitendex structured-content (filtering attribution/xref noise)', async () => {
    const zip = new JSZip();
    zip.file('index.json', JSON.stringify({ title: 'Mazii & Jitendex Test', format: 3 }));
    zip.file(
      'term_bank_1.json',
      JSON.stringify([
        [
          '配電所',
          'はいでんしょ',
          'n',
          '',
          10,
          ['PHỐI ĐIỆN SỞ\n1. trạm phân phối điện.\n2. trạm biến áp phụ.\n'],
          1,
          ''
        ],
        [
          'ブラックアウト',
          'ブラックアウト',
          '',
          '',
          5,
          [
            {
              type: 'structured-content',
              content: [
                {
                  tag: 'div',
                  data: { content: 'sense-group' },
                  content: [
                    {
                      tag: 'span',
                      data: { content: 'part-of-speech-info' },
                      content: 'noun'
                    },
                    {
                      tag: 'div',
                      data: { content: 'sense' },
                      content: [
                        {
                          tag: 'ul',
                          data: { content: 'glossary' },
                          content: { tag: 'li', content: 'blackout; power outage' }
                        },
                        {
                          tag: 'div',
                          data: { content: 'extra-info' },
                          content: 'See also 停電'
                        }
                      ]
                    }
                  ]
                },
                {
                  tag: 'div',
                  data: { content: 'attribution' },
                  content: 'JMdict'
                }
              ]
            }
          ],
          2,
          ''
        ]
      ])
    );

    const parsed = await parseYomitanZip(await zip.generateAsync({ type: 'nodebuffer' }));
    const maziiTerm = parsed.terms.find((t) => t.expression === '配電所')!;
    expect(maziiTerm.hanViet).toBe('PHỐI ĐIỆN SỞ');
    expect(maziiTerm.glosses).toEqual(['trạm phân phối điện.', 'trạm biến áp phụ.']);

    const jitendexTerm = parsed.terms.find((t) => t.expression === 'ブラックアウト')!;
    const joined = jitendexTerm.glosses.join(' ');
    expect(joined).toContain('(noun)');
    expect(joined).toContain('blackout; power outage');
    expect(joined).not.toContain('JMdict');
    expect(joined).not.toContain('See also 停電');
  });

  it('prevents reading-only false Kanji collisions on deinflection (傘 かさ -x-> 会 かい)', () => {
    const store = new DictionaryStore();
    store.addTerm({
      expression: '会',
      reading: 'かい',
      posTags: 'n',
      rules: '',
      score: 80,
      glosses: ['hội họp'],
      dictionary: 'Test'
    });
    store.addTerm({
      expression: '傘',
      reading: 'かさ',
      posTags: 'n',
      rules: '',
      score: 80,
      glosses: ['cái ô / dù'],
      dictionary: 'Test'
    });

    const matches = store.lookupTerms(['傘']);
    expect(matches.map((m) => m.expression)).toEqual(['傘']);
  });
});
