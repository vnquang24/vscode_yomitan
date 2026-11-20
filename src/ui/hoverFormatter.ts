import type { LookupMatch } from '../dictionary/dictionaryStore.js';
import type { KanjiEntry } from '../dictionary/yomitanLoader.js';

export interface HoverRenderInput {
  matches: LookupMatch[];
  kanjiList: KanjiEntry[];
  fallbackSurface: string;
  fallbackReading: string;
  fallbackHanViet: string;
  sentence: string;
  sentenceReading: string;
  cachedTranslation?: string;
}

function encodeCommandUri(commandId: string, args: unknown[]): string {
  return `command:${commandId}?${encodeURIComponent(JSON.stringify(args))}`;
}

function escapeMarkdownInline(text: string): string {
  return text.replace(/([\\`|*_{}[\]()])/g, '\\$1');
}

export function formatYomitanHoverMarkdown(input: HoverRenderInput): string {
  const sections: string[] = [];

  // 1. Yomitan Term Dictionary Section (or Morphological Kana + Hán-Việt fallback)
  if (input.matches.length > 0) {
    const termBlocks: string[] = [];
    for (const m of input.matches) {
      const readingBadge =
        m.reading && m.reading !== m.expression ? ` 【${m.reading}】` : '';
      const hvBadge = m.hanViet ? ` · \`[${m.hanViet}]\`` : '';
      let header = `### **${m.expression}**${readingBadge}${hvBadge}`;

      if (m.deinflectReasons.length > 0 || m.matchedSurface !== m.expression) {
        const reasonStr =
          m.deinflectReasons.length > 0
            ? ` — ${m.deinflectReasons.join(' · ')}`
            : '';
        header += `\n*(từ: \`${m.matchedSurface}\`${reasonStr})*`;
      }

      const glossLines = m.glosses
        .slice(0, 4)
        .map((g, idx) => `${idx + 1}. ${g.replace(/\n+/g, ' — ')}`)
        .join('\n');

      termBlocks.push(`${header}\n${glossLines}`);
    }
    sections.push(termBlocks.join('\n\n---\n\n'));
  } else {
    const readingPart =
      input.fallbackReading && input.fallbackReading !== input.fallbackSurface
        ? ` 【${input.fallbackReading}】`
        : '';
    const hvPart = input.fallbackHanViet
      ? ` · \`[${input.fallbackHanViet}]\``
      : '';
    sections.push(
      `### **${escapeMarkdownInline(input.fallbackSurface)}**${readingPart}${hvPart}\n*(Chưa có mục từ ghép trong từ điển — đã tách Kana & Hán-Việt tự động)*`
    );
  }

  // 2. Kanji Breakdown (Hán tự & Âm Hán-Việt)
  if (input.kanjiList.length > 0) {
    const kanjiLines = input.kanjiList.slice(0, 6).map((k) => {
      const hv = k.hanViet ? ` \`[${k.hanViet}]\`` : '';
      const shortMeaning = k.meanings.slice(0, 2).join('; ');
      const meaningPart = shortMeaning ? ` — ${shortMeaning}` : '';
      return `- **${k.character}**${hv}${meaningPart}`;
    });
    sections.push(`**Hán tự:**\n${kanjiLines.join('\n')}`);
  }

  // 3. Sentence Reading (Kana) + Offline Local LLM Translation
  if (input.sentence) {
    const sentenceParts: string[] = [
      `**Câu:** ${escapeMarkdownInline(input.sentence)}`
    ];
    if (input.sentenceReading && input.sentenceReading !== input.sentence) {
      sentenceParts.push(`**Kana:** ${escapeMarkdownInline(input.sentenceReading)}`);
    }

    if (input.cachedTranslation) {
      sentenceParts.push(`🤖 **Dịch (Local AI):** ${escapeMarkdownInline(input.cachedTranslation)}`);
    }

    const translateUri = encodeCommandUri('yomiJavi.translateText', [
      input.sentence
    ]);
    const panelUri = encodeCommandUri('yomiJavi.openLookupPanel', [
      input.sentence
    ]);

    const translateLabel = input.cachedTranslation
      ? '[🔄 Xem trong bảng dịch]'
      : '[🤖 Dịch câu này (Local LLM)]';

    sentenceParts.push(
      `${translateLabel}(${translateUri}) · [📖 Chi tiết Yomitan](${panelUri})`
    );

    sections.push(sentenceParts.join('\n\n'));
  }

  return sections.join('\n\n---\n\n');
}
