import * as vscode from 'vscode';
import type { DictionaryStore } from '../dictionary/dictionaryStore.js';
import type { JapaneseAnalyzer } from '../japanese/analyzer.js';
import { containsJapanese } from '../japanese/kana.js';
import type { LlmTranslator } from '../llm/llmTranslator.js';
import { formatYomitanHoverMarkdown } from './hoverFormatter.js';

export class YomiJaviHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly ensureDictionariesLoaded: () => Promise<DictionaryStore>,
    private readonly analyzer: JapaneseAnalyzer,
    private readonly translator: LlmTranslator
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const config = vscode.workspace.getConfiguration('yomiJavi');
    if (!config.get<boolean>('hover.enabled', true)) {
      return null;
    }

    const lineText = document.lineAt(position.line).text;
    // Ultra-fast <0.01ms guard: ignore lines with no Japanese characters
    if (!containsJapanese(lineText)) {
      return null;
    }

    const analyzed = await this.analyzer.analyzeAtOffset(
      lineText,
      position.character
    );
    if (!analyzed || token.isCancellationRequested) {
      return null;
    }

    const store = await this.ensureDictionariesLoaded();
    if (token.isCancellationRequested) {
      return null;
    }

    const maxEntries = config.get<number>('hover.maxEntries', 5);
    const matches = store.lookupTerms(analyzed.lookupCandidates, maxEntries);

    const primaryKanjiTarget =
      matches.length > 0 ? matches[0].expression : analyzed.tokenSurface;
    const kanjiList = store.lookupKanjiList(primaryKanjiTarget);
    const fallbackHanViet = store.computeCompoundHanViet(analyzed.tokenSurface);
    const cachedTranslation = this.translator.getCached(
      analyzed.context.sentence
    );

    const markdownBody = formatYomitanHoverMarkdown({
      matches,
      kanjiList,
      fallbackSurface: analyzed.tokenSurface,
      fallbackReading: analyzed.tokenReadingHiragana,
      fallbackHanViet,
      sentence: analyzed.context.sentence,
      sentenceReading: analyzed.sentenceReadingHiragana,
      cachedTranslation
    });

    const md = new vscode.MarkdownString(markdownBody);
    md.isTrusted = {
      enabledCommands: ['yomiJavi.translateText', 'yomiJavi.openLookupPanel']
    };

    return new vscode.Hover(md);
  }
}
