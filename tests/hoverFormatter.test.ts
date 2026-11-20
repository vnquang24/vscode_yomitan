import { describe, expect, it } from 'vitest';
import { formatYomitanHoverMarkdown } from '../src/ui/hoverFormatter.js';

describe('formatYomitanHoverMarkdown', () => {
  it('renders Yomitan-style term header with Kana, Hán-Việt, deinflection chain, Kanji breakdown, and encoded command links', () => {
    const md = formatYomitanHoverMarkdown({
      matches: [
        {
          expression: '実装',
          reading: 'じっそう',
          hanViet: 'THỰC TRANG',
          glosses: ['triển khai code; cài đặt (implementation)'],
          posTags: 'n vs',
          dictionary: 'Từ điển Nhật - Việt',
          matchedSurface: '実装されていません',
          deinflectReasons: ['bị động (-される)', 'tiếp diễn (-ている)', 'phủ định lịch sự'],
          score: 1200
        }
      ],
      kanjiList: [
        {
          character: '実',
          hanViet: 'THỰC',
          onyomi: '',
          kunyomi: 'み',
          meanings: ['[thực] thực tế, chân thực'],
          tags: '',
          dictionary: 'KanjiDictVN'
        },
        {
          character: '装',
          hanViet: 'TRANG',
          onyomi: '',
          kunyomi: 'よそお.う',
          meanings: ['[trang] trang bị, lắp đặt'],
          tags: '',
          dictionary: 'KanjiDictVN'
        }
      ],
      fallbackSurface: '実装',
      fallbackReading: 'じっそう',
      fallbackHanViet: 'THỰC TRANG',
      sentence: 'この機能はまだ実装されていません。',
      sentenceReading: 'このきのうはまだじっそうされていません。',
      cachedTranslation: undefined
    });

    expect(md).toContain('**実装**');
    expect(md).toContain('【じっそう】');
    expect(md).toContain('THỰC TRANG');
    expect(md).toContain('実装されていません');
    expect(md).toContain('triển khai code; cài đặt (implementation)');
    expect(md).toContain('**実** `[THỰC]`');
    expect(md).toContain('command:yomiJavi.translateText?');
    // Command args must be URI-encoded JSON array so VS Code executes cleanly even with quotes/parentheses
    expect(md).toContain(encodeURIComponent(JSON.stringify(['この機能はまだ実装されていません。'])));
  });

  it('displays cached Local LLM Vietnamese translation immediately when available and falls back to kuromoji reading if term not in dict', () => {
    const md = formatYomitanHoverMarkdown({
      matches: [],
      kanjiList: [],
      fallbackSurface: '未登録語',
      fallbackReading: 'みとうろくご',
      fallbackHanViet: 'VỊ ĐĂNG LỤC NGỮ',
      sentence: '未登録語が見つかりました。',
      sentenceReading: 'みとうろくごがみつかりました。',
      cachedTranslation: 'Đã tìm thấy từ chưa đăng ký.'
    });

    expect(md).toContain('**未登録語**');
    expect(md).toContain('【みとうろくご】');
    expect(md).toContain('VỊ ĐĂNG LỤC NGỮ');
    expect(md).toContain('Đã tìm thấy từ chưa đăng ký.');
  });

  it('escapes Markdown image/link/HTML payloads inside 3rd-party dictionary glosses to prevent outbound tracking pings', () => {
    const md = formatYomitanHoverMarkdown({
      matches: [
        {
          expression: 'テスト',
          reading: 'てすと',
          hanViet: '',
          glosses: ['kiểm thử ![](https://evil.example.com/track.png) <img src="https://evil.example.com/x">'],
          posTags: 'n',
          dictionary: 'UntrustedDict',
          matchedSurface: 'テスト',
          deinflectReasons: [],
          score: 100
        }
      ],
      kanjiList: [],
      fallbackSurface: 'テスト',
      fallbackReading: 'てすと',
      fallbackHanViet: '',
      sentence: 'テストを実行する',
      sentenceReading: 'てすとをじっこうする'
    });

    // Must escape ![ and <img so VS Code Markdown renderer never fires outbound HTTP requests
    expect(md).toContain('\\!\\[\\]');
    expect(md).toContain('\\<img');
  });
});
