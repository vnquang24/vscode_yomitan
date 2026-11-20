import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import type { DictionaryStore } from '../dictionary/dictionaryStore.js';
import type { JapaneseAnalyzer } from '../japanese/analyzer.js';
import type { LlmTranslator } from '../llm/llmTranslator.js';

export interface SidebarCallbacks {
  ensureDictionariesLoaded: () => Promise<DictionaryStore>;
  analyzer: JapaneseAnalyzer;
  translator: LlmTranslator;
  getLlmStatusText: () => string;
}

const ALLOWED_WEBVIEW_COMMANDS = new Set([
  'yomiJavi.downloadModel',
  'yomiJavi.selectLocalGguf',
  'yomiJavi.stopLlmServer',
  'yomiJavi.importYomitanZip'
]);

export class YomiJaviSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'yomiJavi.lookupView';
  private view?: vscode.WebviewView;
  private pendingText?: string;
  private pendingAutoTranslate = false;

  constructor(private readonly deps: SidebarCallbacks) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };
    webviewView.webview.html = this.buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: { type: string; text?: string }) => {
      if (msg.type === 'ready') {
        this.pushStatusUpdate();
        if (this.pendingText) {
          const textToRun = this.pendingText;
          const autoTranslate = this.pendingAutoTranslate;
          this.pendingText = undefined;
          this.pendingAutoTranslate = false;
          await this.inspectAndOptionallyTranslate(textToRun, autoTranslate);
        }
        return;
      }

      if (msg.type === 'lookup' && typeof msg.text === 'string') {
        await this.inspectAndOptionallyTranslate(msg.text, false);
        return;
      }

      if (msg.type === 'translate' && typeof msg.text === 'string') {
        await this.inspectAndOptionallyTranslate(msg.text, true);
        return;
      }

      if (msg.type === 'command' && typeof msg.text === 'string') {
        if (ALLOWED_WEBVIEW_COMMANDS.has(msg.text)) {
          await vscode.commands.executeCommand(msg.text);
        }
      }
    });
  }

  pushStatusUpdate(): void {
    if (!this.view) return;
    void this.view.webview.postMessage({
      type: 'status',
      statusText: this.deps.getLlmStatusText()
    });
  }

  async openWithText(japaneseText: string, autoTranslate: boolean): Promise<void> {
    this.pendingText = japaneseText;
    this.pendingAutoTranslate = autoTranslate;

    await vscode.commands.executeCommand('yomiJavi.lookupView.focus');
    if (this.view) {
      this.pendingText = undefined;
      this.pendingAutoTranslate = false;
      await this.inspectAndOptionallyTranslate(japaneseText, autoTranslate);
    }
  }

  private async inspectAndOptionallyTranslate(
    rawText: string,
    runLlm: boolean
  ): Promise<void> {
    const text = rawText.trim();
    if (!text || !this.view) return;

    await this.deps.analyzer.init();
    const store = await this.deps.ensureDictionariesLoaded();

    const kanaReading = this.deps.analyzer.toHiraganaReading(text);
    const tokens = this.deps.analyzer.tokenize(text);

    // Collect unique content words across the sentence for Yomitan breakdown
    const seenExpr = new Set<string>();
    const vocabItems: Array<{
      expression: string;
      reading: string;
      hanViet: string;
      gloss: string;
    }> = [];

    for (const tk of tokens) {
      if (['助詞', '助動詞', '記号'].includes(tk.pos)) continue;
      const cands = [tk.surface_form];
      if (tk.basic_form && tk.basic_form !== '*') {
        cands.unshift(tk.basic_form);
      }
      const matches = store.lookupTerms(cands, 1);
      if (matches.length > 0) {
        const m = matches[0];
        if (!seenExpr.has(m.expression)) {
          seenExpr.add(m.expression);
          vocabItems.push({
            expression: m.expression,
            reading: m.reading,
            hanViet: m.hanViet,
            gloss: m.glosses.slice(0, 2).join('; ')
          });
        }
      }
      if (vocabItems.length >= 12) break;
    }

    const kanjiItems = store.lookupKanjiList(text).slice(0, 12);
    const cached = this.deps.translator.getCached(text);

    await this.view.webview.postMessage({
      type: 'analysis',
      source: text,
      kanaReading,
      vocabItems,
      kanjiItems,
      translation: cached ?? null,
      translating: runLlm && !cached
    });

    if (runLlm) {
      try {
        const res = await this.deps.translator.translate(text);
        this.pushStatusUpdate();
        await this.view.webview.postMessage({
          type: 'translationResult',
          translation: res.translation,
          meta: `${res.modelLabel} · ${res.fromCache ? '0ms (Cache)' : `${res.latencyMs}ms`}`
        });
      } catch (err) {
        this.pushStatusUpdate();
        const message = err instanceof Error ? err.message : String(err);
        await this.view.webview.postMessage({
          type: 'translationError',
          error: message
        });
      }
    }
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 10px;
      margin: 0;
      font-size: 13px;
      line-height: 1.5;
    }
    .badge-security {
      font-size: 11px;
      padding: 4px 8px;
      border-radius: 4px;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-widget-border, #444);
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
    }
    textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 68px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 4px;
      padding: 6px 8px;
      font-family: inherit;
      resize: vertical;
    }
    .btn-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
      margin-bottom: 10px;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
      padding: 5px 10px;
      cursor: pointer;
      font-size: 12px;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button:hover {
      opacity: 0.92;
    }
    .card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border, #3c3c3c);
      border-radius: 5px;
      padding: 8px 10px;
      margin-bottom: 8px;
    }
    .card-title {
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      opacity: 0.8;
      margin-bottom: 4px;
    }
    .hv {
      font-size: 11px;
      color: var(--vscode-textPreformat-foreground);
      font-weight: 600;
    }
    .vocab-item {
      border-bottom: 1px solid var(--vscode-widget-border, #2d2d2d);
      padding: 5px 0;
    }
    .vocab-item:last-child {
      border-bottom: none;
    }
    .meta {
      font-size: 11px;
      opacity: 0.75;
      margin-top: 4px;
    }
    .error {
      color: var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <div class="badge-security">
    <span>🔒 100% Localhost</span>
    <span id="llmStatus">Idle (0 MB)</span>
  </div>

  <textarea id="jaInput" placeholder="Nhập hoặc bôi đen câu tiếng Nhật rồi bấm Ctrl+Shift+Y..."></textarea>
  <div class="btn-row">
    <button id="btnTranslate">🤖 Dịch Nhật → Việt (LLM)</button>
    <button id="btnLookup" class="secondary">📖 Tách từ Yomitan</button>
  </div>

  <div id="kanaCard" class="card" style="display:none;">
    <div class="card-title">Cách đọc Kana (Hiragana)</div>
    <div id="kanaBody"></div>
  </div>

  <div id="transCard" class="card" style="display:none;">
    <div class="card-title">Bản dịch Tiếng Việt (Offline AI)</div>
    <div id="transBody"></div>
    <div id="transMeta" class="meta"></div>
  </div>

  <div id="vocabCard" class="card" style="display:none;">
    <div class="card-title">Từ vựng trong câu (Yomitan)</div>
    <div id="vocabBody"></div>
  </div>

  <div id="kanjiCard" class="card" style="display:none;">
    <div class="card-title">Phân tích Hán tự (Hán-Việt)</div>
    <div id="kanjiBody"></div>
  </div>

  <hr style="border:none;border-top:1px solid var(--vscode-widget-border,#333);margin:10px 0;" />
  <div class="btn-row">
    <button class="secondary" data-cmd="yomiJavi.downloadModel">⬇️ Tải Model LLM</button>
    <button class="secondary" data-cmd="yomiJavi.selectLocalGguf">📂 Chọn .gguf</button>
    <button class="secondary" data-cmd="yomiJavi.stopLlmServer">🧹 Giải phóng RAM</button>
    <button class="secondary" data-cmd="yomiJavi.importYomitanZip">📚 Import Yomitan .zip</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const jaInput = document.getElementById('jaInput');
    const llmStatus = document.getElementById('llmStatus');
    const kanaCard = document.getElementById('kanaCard');
    const kanaBody = document.getElementById('kanaBody');
    const transCard = document.getElementById('transCard');
    const transBody = document.getElementById('transBody');
    const transMeta = document.getElementById('transMeta');
    const vocabCard = document.getElementById('vocabCard');
    const vocabBody = document.getElementById('vocabBody');
    const kanjiCard = document.getElementById('kanjiCard');
    const kanjiBody = document.getElementById('kanjiBody');

    document.getElementById('btnTranslate').addEventListener('click', () => {
      vscode.postMessage({ type: 'translate', text: jaInput.value });
    });

    document.getElementById('btnLookup').addEventListener('click', () => {
      vscode.postMessage({ type: 'lookup', text: jaInput.value });
    });

    document.querySelectorAll('[data-cmd]').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'command', text: btn.getAttribute('data-cmd') });
      });
    });

    function esc(str) {
      const div = document.createElement('div');
      div.textContent = str || '';
      return div.innerHTML;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'status') {
        llmStatus.textContent = msg.statusText;
      } else if (msg.type === 'analysis') {
        jaInput.value = msg.source;
        kanaCard.style.display = 'block';
        kanaBody.textContent = msg.kanaReading;

        if (msg.translating) {
          transCard.style.display = 'block';
          transBody.innerHTML = '<em>⏳ Đang dịch bằng Small LLM nội bộ...</em>';
          transMeta.textContent = '';
        } else if (msg.translation) {
          transCard.style.display = 'block';
          transBody.textContent = msg.translation;
          transMeta.textContent = 'LRU Cache (0ms)';
        } else {
          transCard.style.display = 'none';
          transBody.textContent = '';
          transMeta.textContent = '';
        }

        if (msg.vocabItems && msg.vocabItems.length > 0) {
          vocabCard.style.display = 'block';
          vocabBody.innerHTML = msg.vocabItems.map((v) =>
            '<div class="vocab-item"><strong>' + esc(v.expression) + '</strong> 【' + esc(v.reading) + '】 ' +
            (v.hanViet ? '<span class="hv">[' + esc(v.hanViet) + ']</span>' : '') +
            '<div>' + esc(v.gloss) + '</div></div>'
          ).join('');
        } else {
          vocabCard.style.display = 'none';
        }

        if (msg.kanjiItems && msg.kanjiItems.length > 0) {
          kanjiCard.style.display = 'block';
          kanjiBody.innerHTML = msg.kanjiItems.map((k) =>
            '<div class="vocab-item"><strong>' + esc(k.character) + '</strong> ' +
            (k.hanViet ? '<span class="hv">[' + esc(k.hanViet) + ']</span> ' : '') +
            esc((k.meanings || []).slice(0, 2).join('; ')) + '</div>'
          ).join('');
        } else {
          kanjiCard.style.display = 'none';
        }
      } else if (msg.type === 'translationResult') {
        transCard.style.display = 'block';
        transBody.textContent = msg.translation;
        transMeta.textContent = msg.meta || '';
      } else if (msg.type === 'translationError') {
        transCard.style.display = 'block';
        transBody.innerHTML = '<span class="error">' + esc(msg.error) + '</span>';
        transMeta.textContent = '';
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
