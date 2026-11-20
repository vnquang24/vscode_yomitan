const HIRAGANA_REGEX = /[\u3040-\u309F]/;
const KATAKANA_REGEX = /[\u30A0-\u30FF\uFF66-\uFF9F]/;
const KANJI_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF々〆〇]/;
const JAPANESE_CHAR_REGEX =
  /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF01-\uFF9F々〆〇ー]/;

export function katakanaToHiragana(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    // Standard Katakana ァ (0x30A1) .. ヶ (0x30F6) -> Hiragana ぁ (0x3041) .. ゖ (0x3096)
    if (code >= 0x30a1 && code <= 0x30f6) {
      out += String.fromCharCode(code - 0x60);
    } else {
      out += input[i];
    }
  }
  return out;
}

export function isKanji(ch: string): boolean {
  if (!ch) return false;
  return KANJI_REGEX.test(ch[0]);
}

export function isJapaneseChar(ch: string): boolean {
  if (!ch) return false;
  return JAPANESE_CHAR_REGEX.test(ch[0]);
}

export function containsJapanese(text: string): boolean {
  return (
    HIRAGANA_REGEX.test(text) ||
    KATAKANA_REGEX.test(text) ||
    KANJI_REGEX.test(text)
  );
}

export function extractKanjiChars(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ch of text) {
    if (isKanji(ch) && !seen.has(ch)) {
      seen.add(ch);
      result.push(ch);
    }
  }
  return result;
}
