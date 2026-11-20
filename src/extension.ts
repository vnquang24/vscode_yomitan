import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DictionaryStore } from './dictionary/dictionaryStore.js';
import { JapaneseAnalyzer } from './japanese/analyzer.js';
import { extractContextAtOffset, cleanCodeArtifacts } from './japanese/textExtractor.js';
import { LlamaServerManager } from './llm/llamaServerManager.js';
import { LlmTranslator } from './llm/llmTranslator.js';
import {
  downloadFileWithProgress,
  MODEL_PRESETS
} from './llm/modelCatalog.js';
import { YomiJaviHoverProvider } from './ui/hoverProvider.js';
import { YomiJaviSidebarProvider } from './ui/sidebarProvider.js';

let globalLlamaManager: LlamaServerManager | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const storagePath = context.globalStorageUri.fsPath;
  fs.mkdirSync(storagePath, { recursive: true });

  // Resolve kuromoji dictionary path (production bundled data/kuromoji-dict or dev node_modules)
  const prodKuromojiDir = path.join(context.extensionPath, 'data', 'kuromoji-dict');
  const devKuromojiDir = path.join(context.extensionPath, 'node_modules', 'kuromoji', 'dict');
  const kuromojiDicPath = fs.existsSync(prodKuromojiDir) ? prodKuromojiDir : devKuromojiDir;

  const analyzer = new JapaneseAnalyzer(kuromojiDicPath);
  const llamaManager = new LlamaServerManager(storagePath);
  globalLlamaManager = llamaManager;

  // Lazy-loaded DictionaryStore singleton
  let dictStore: DictionaryStore | null = null;
  let dictLoadingPromise: Promise<DictionaryStore> | null = null;

  const ensureDictionariesLoaded = async (): Promise<DictionaryStore> => {
    if (dictStore) return dictStore;
    if (dictLoadingPromise) return dictLoadingPromise;

    dictLoadingPromise = (async () => {
      const store = new DictionaryStore();
      const kanjiZip = path.join(context.extensionPath, 'data', 'KANJIDIC_vietnamese.zip');
      const javiGz = path.join(context.extensionPath, 'data', 'javi-dict.json.gz');

      if (fs.existsSync(kanjiZip)) {
        await store.importYomitanZip(kanjiZip);
      }
      if (fs.existsSync(javiGz)) {
        await store.loadCompactBundleGz(javiGz);
      }

      // Also load any user-imported Yomitan .zip dictionaries saved in globalStorage
      const userDictDir = path.join(storagePath, 'dictionaries');
      if (fs.existsSync(userDictDir)) {
        for (const file of fs.readdirSync(userDictDir)) {
          if (file.endsWith('.zip')) {
            try {
              await store.importYomitanZip(path.join(userDictDir, file));
            } catch (err) {
              console.warn(`Không đọc được từ điển ${file}:`, err);
            }
          }
        }
      }

      dictStore = store;
      return store;
    })();

    return dictLoadingPromise;
  };

  // Status bar item showing privacy & LLM RAM status
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  let llmStatusLabel = 'Idle (0 MB RAM)';

  const updateStatusBar = (detail?: string) => {
    const cfg = vscode.workspace.getConfiguration('yomiJavi');
    const hoverOn = cfg.get<boolean>('hover.enabled', true);
    if (detail) {
      llmStatusLabel = detail;
    }
    statusBar.text = `$(shield) Yomi Ja-Vi${hoverOn ? '' : ' (Tắt Hover)'}: ${llmStatusLabel}`;
    statusBar.tooltip =
      'Yomi Ja-Vi — Tra từ Yomitan Offline & Dịch câu bằng Small Local LLM (100% bảo mật localhost).\nBấm để mở menu tác vụ nhanh.';
    statusBar.command = 'yomiJavi.quickMenu';
    statusBar.show();
  };
  updateStatusBar();
  context.subscriptions.push(statusBar);

  const resolveManagedModelPath = (): string => {
    const cfg = vscode.workspace.getConfiguration('yomiJavi');
    const preset = cfg.get<'qwen2.5-3b' | 'qwen3-1.7b' | 'custom-gguf'>(
      'llm.modelPreset',
      'qwen2.5-3b'
    );
    if (preset === 'custom-gguf') {
      const customPath = cfg.get<string>('llm.customGgufPath', '').trim();
      if (!customPath) {
        throw new Error(
          'Bạn đang chọn custom-gguf nhưng chưa cấu hình đường dẫn file .gguf. Hãy chạy "Yomi Ja-Vi: Chọn file model .gguf có sẵn trên máy".'
        );
      }
      return customPath;
    }
    const info = MODEL_PRESETS[preset] ?? MODEL_PRESETS['qwen2.5-3b'];
    return path.join(storagePath, 'models', info.fileName);
  };

  let sidebarProvider: YomiJaviSidebarProvider;

  const translator = new LlmTranslator({
    getConfig: () => {
      const cfg = vscode.workspace.getConfiguration('yomiJavi');
      return {
        backend: cfg.get<'managed-llama' | 'ollama'>('llm.backend', 'managed-llama'),
        ollamaEndpoint: cfg.get<string>('llm.ollamaEndpoint', 'http://127.0.0.1:11434'),
        ollamaModel: cfg.get<string>('llm.ollamaModel', 'qwen2.5:3b'),
        modelPreset: cfg.get<string>('llm.modelPreset', 'qwen2.5-3b'),
        idleUnloadSeconds: cfg.get<number>('llm.idleUnloadSeconds', 300)
      };
    },
    ensureManagedEndpoint: async () => {
      const cfg = vscode.workspace.getConfiguration('yomiJavi');
      return llamaManager.ensureStarted({
        storageDir: storagePath,
        modelPath: resolveManagedModelPath(),
        threads: cfg.get<number>('llm.threads', 8),
        idleUnloadSeconds: cfg.get<number>('llm.idleUnloadSeconds', 300),
        onStateChange: (_state, detail) => {
          updateStatusBar(detail);
          sidebarProvider?.pushStatusUpdate();
        }
      });
    },
    onActivity: () => {
      const cfg = vscode.workspace.getConfiguration('yomiJavi');
      if (cfg.get<string>('llm.backend', 'managed-llama') === 'managed-llama') {
        llamaManager.resetIdleTimer(
          cfg.get<number>('llm.idleUnloadSeconds', 300),
          (_state, detail) => {
            updateStatusBar(detail);
            sidebarProvider?.pushStatusUpdate();
          }
        );
      }
    }
  });

  sidebarProvider = new YomiJaviSidebarProvider({
    ensureDictionariesLoaded,
    analyzer,
    translator,
    getLlmStatusText: () => llmStatusLabel
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      YomiJaviSidebarProvider.viewType,
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Register HoverProvider across all file types (NO inline Kana decorations!)
  const hoverProvider = new YomiJaviHoverProvider(
    ensureDictionariesLoaded,
    analyzer,
    translator
  );
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: '*' }, hoverProvider)
  );

  // Helper: translate and display in Sidebar + notification
  const runInteractiveTranslation = async (rawText: string) => {
    const cleaned = cleanCodeArtifacts(rawText);
    if (!cleaned) {
      void vscode.window.showInformationMessage('Không có nội dung tiếng Nhật để dịch.');
      return;
    }

    await sidebarProvider.openWithText(cleaned, true);
  };

  // Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'yomiJavi.translateText',
      async (argText?: string) => {
        let text = typeof argText === 'string' ? argText : '';
        if (!text) {
          text =
            (await vscode.window.showInputBox({
              prompt: 'Nhập câu tiếng Nhật cần dịch sang tiếng Việt (100% Local LLM)',
              placeHolder: 'この機能はまだ実装されていません。'
            })) ?? '';
        }
        if (text) {
          await runInteractiveTranslation(text);
        }
      }
    ),

    vscode.commands.registerCommand('yomiJavi.translateSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      let text = editor.document.getText(editor.selection).trim();
      if (!text) {
        const line = editor.document.lineAt(editor.selection.active.line).text;
        const ctx = extractContextAtOffset(line, editor.selection.active.character);
        text = ctx?.sentence ?? '';
      }
      await runInteractiveTranslation(text);
    }),

    vscode.commands.registerCommand(
      'yomiJavi.openLookupPanel',
      async (argText?: string) => {
        const text = typeof argText === 'string' ? argText : '';
        if (text) {
          await sidebarProvider.openWithText(text, false);
        } else {
          await vscode.commands.executeCommand('yomiJavi.lookupView.focus');
        }
      }
    ),

    vscode.commands.registerCommand('yomiJavi.importYomitanZip', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Import từ điển Yomitan (.zip)',
        filters: { 'Yomitan Dictionary (.zip)': ['zip'] }
      });
      if (!uris || uris.length === 0) return;

      const srcPath = uris[0].fsPath;
      const destDir = path.join(storagePath, 'dictionaries');
      await fsp.mkdir(destDir, { recursive: true });
      const destPath = path.join(destDir, path.basename(srcPath));
      await fsp.copyFile(srcPath, destPath);

      const store = await ensureDictionariesLoaded();
      const title = await store.importYomitanZip(destPath);
      void vscode.window.showInformationMessage(
        `Đã nạp thành công từ điển Yomitan: "${title}"!`
      );
    }),

    vscode.commands.registerCommand('yomiJavi.downloadModel', async () => {
      const pick = await vscode.window.showQuickPick(
        [
          {
            label: '$(star-full) Qwen2.5-3B-Instruct (Q4_K_M ~1.98 GB)',
            description: 'Khuyên dùng cho máy 16GB RAM (Core Ultra 7)',
            detail: MODEL_PRESETS['qwen2.5-3b'].description,
            presetId: 'qwen2.5-3b' as const
          },
          {
            label: '$(zap) Qwen3-1.7B (Q4_K_M ~1.11 GB)',
            description: 'Siêu nhẹ, tốc độ phản hồi cực nhanh',
            detail: MODEL_PRESETS['qwen3-1.7b'].description,
            presetId: 'qwen3-1.7b' as const
          }
        ],
        {
          placeHolder:
            'Chọn model Small LLM để tải về chạy Offline 100% trên máy (không gửi code ra ngoài)'
        }
      );
      if (!pick) return;

      const presetInfo = MODEL_PRESETS[pick.presetId];
      const modelDest = path.join(storagePath, 'models', presetInfo.fileName);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Yomi Ja-Vi: Cài đặt ${presetInfo.id}`,
          cancellable: true
        },
        async (progress, cancelToken) => {
          const abortController = new AbortController();
          cancelToken.onCancellationRequested(() => abortController.abort());

          await llamaManager.ensureBinaryInstalled((msg) => {
            progress.report({ message: msg });
          }, abortController.signal);

          if (!fs.existsSync(modelDest)) {
            let lastPct = 0;
            await downloadFileWithProgress(
              presetInfo.downloadUrl,
              modelDest,
              (loaded, total) => {
                const pct = total > 0 ? Math.floor((loaded / total) * 100) : 0;
                const inc = Math.max(0, pct - lastPct);
                lastPct = pct;
                progress.report({
                  increment: inc,
                  message: `Đang tải model ${(loaded / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB (${pct}%)`
                });
              },
              abortController.signal
            );
          }

          await vscode.workspace
            .getConfiguration('yomiJavi')
            .update('llm.backend', 'managed-llama', vscode.ConfigurationTarget.Global);
          await vscode.workspace
            .getConfiguration('yomiJavi')
            .update('llm.modelPreset', pick.presetId, vscode.ConfigurationTarget.Global);
        }
      );

      void vscode.window.showInformationMessage(
        `Đã sẵn sàng! Model ${presetInfo.id} đã lưu offline tại máy. Bấm "Dịch câu này" trong Hover hoặc Ctrl+Shift+Y để dịch.`
      );
    }),

    vscode.commands.registerCommand('yomiJavi.selectLocalGguf', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Chọn file model .gguf',
        filters: { 'GGUF Model': ['gguf'] }
      });
      if (!uris || uris.length === 0) return;

      const selected = uris[0].fsPath;
      const cfg = vscode.workspace.getConfiguration('yomiJavi');
      await cfg.update('llm.backend', 'managed-llama', vscode.ConfigurationTarget.Global);
      await cfg.update('llm.modelPreset', 'custom-gguf', vscode.ConfigurationTarget.Global);
      await cfg.update('llm.customGgufPath', selected, vscode.ConfigurationTarget.Global);

      // Ensure llama-server engine binary is also installed if needed
      if (!llamaManager.getBinaryPath()) {
        const action = await vscode.window.showInformationMessage(
          `Đã chọn model "${path.basename(selected)}". Cần tải thêm engine thực thi llama-server (~22MB) một lần duy nhất.`,
          'Tải llama-server ngay'
        );
        if (action) {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Đang tải engine llama-server...'
            },
            async (progress) => {
              await llamaManager.ensureBinaryInstalled((msg) =>
                progress.report({ message: msg })
              );
            }
          );
        }
      } else {
        void vscode.window.showInformationMessage(
          `Đã cấu hình sử dụng model offline: ${path.basename(selected)}`
        );
      }
    }),

    vscode.commands.registerCommand('yomiJavi.stopLlmServer', async () => {
      await llamaManager.stop((_state, detail) => {
        updateStatusBar(detail);
        sidebarProvider.pushStatusUpdate();
      });
      void vscode.window.showInformationMessage(
        'Đã dừng tiến trình Local LLM và giải phóng hoàn toàn RAM.'
      );
    }),

    vscode.commands.registerCommand('yomiJavi.toggleHover', async () => {
      const cfg = vscode.workspace.getConfiguration('yomiJavi');
      const next = !cfg.get<boolean>('hover.enabled', true);
      await cfg.update('hover.enabled', next, vscode.ConfigurationTarget.Global);
      updateStatusBar();
      void vscode.window.showInformationMessage(
        `Tra từ Yomitan khi di chuột: ${next ? 'ĐÃ BẬT' : 'ĐÃ TẮT'}`
      );
    }),

    vscode.commands.registerCommand('yomiJavi.quickMenu', async () => {
      const item = await vscode.window.showQuickPick(
        [
          {
            label: '$(comment-discussion) Dịch vùng đang bôi đen (Ctrl+Shift+Y)',
            cmd: 'yomiJavi.translateSelection'
          },
          {
            label: '$(cloud-download) Tải Small LLM Offline (Qwen2.5-3B / Qwen3-1.7B)',
            cmd: 'yomiJavi.downloadModel'
          },
          {
            label: '$(folder-opened) Chọn file model .gguf có sẵn trên máy',
            cmd: 'yomiJavi.selectLocalGguf'
          },
          {
            label: '$(trash) Giải phóng RAM Model LLM ngay lập tức',
            cmd: 'yomiJavi.stopLlmServer'
          },
          {
            label: '$(book) Import thêm từ điển Yomitan (.zip)',
            cmd: 'yomiJavi.importYomitanZip'
          },
          {
            label: '$(eye) Bật/Tắt popup Yomitan khi di chuột',
            cmd: 'yomiJavi.toggleHover'
          }
        ],
        { placeHolder: 'Yomi Ja-Vi — Tác vụ nhanh (100% Offline & Bảo mật)' }
      );
      if (item) {
        await vscode.commands.executeCommand(item.cmd);
      }
    })
  );
}

export async function deactivate(): Promise<void> {
  if (globalLlamaManager) {
    await globalLlamaManager.stop();
    globalLlamaManager = null;
  }
}
