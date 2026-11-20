import * as path from 'node:path';
import { buildTranslationMessages, cleanModelOutput } from './promptBuilder.js';
import { assertLocalhostUrl } from './securityGuard.js';
import { TranslationCache } from './translationCache.js';

export interface TranslatorRuntimeConfig {
  backend: 'managed-llama' | 'ollama';
  ollamaEndpoint: string;
  ollamaModel: string;
  modelPreset: string;
  customGgufPath?: string;
  idleUnloadSeconds: number;
}

export interface LlmTranslatorDeps {
  getConfig: () => TranslatorRuntimeConfig;
  ensureManagedEndpoint: () => Promise<string>;
  onRequestStart?: () => void;
  onRequestEnd?: () => void;
  onActivity?: () => void;
}

export interface TranslationResult {
  source: string;
  translation: string;
  fromCache: boolean;
  latencyMs: number;
  modelLabel: string;
}

export class LlmTranslator {
  private readonly cache = new TranslationCache(500);

  constructor(private readonly deps: LlmTranslatorDeps) {}

  getCached(japaneseText: string): string | undefined {
    return this.cache.get(japaneseText);
  }

  clearCache(): void {
    this.cache.clear();
  }

  async translate(
    japaneseText: string,
    abortSignal?: AbortSignal
  ): Promise<TranslationResult> {
    const trimmed = japaneseText.trim();
    if (!trimmed) {
      return {
        source: '',
        translation: '',
        fromCache: true,
        latencyMs: 0,
        modelLabel: 'cache'
      };
    }

    const cached = this.cache.get(trimmed);
    if (cached !== undefined) {
      return {
        source: trimmed,
        translation: cached,
        fromCache: true,
        latencyMs: 0,
        modelLabel: 'LRU Cache'
      };
    }

    const startTime = Date.now();
    const cfg = this.deps.getConfig();
    this.deps.onRequestStart?.();

    try {
      let rawContent = '';
      let modelLabel = '';

      if (cfg.backend === 'ollama') {
        const baseUrl = assertLocalhostUrl(cfg.ollamaEndpoint);
        const chatUrl = new URL('/api/chat', baseUrl);
        assertLocalhostUrl(chatUrl.toString());

        modelLabel = `Ollama (${cfg.ollamaModel})`;
        const messages = buildTranslationMessages(trimmed, cfg.ollamaModel);

        const res = await fetch(chatUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          redirect: 'error',
          signal: abortSignal,
          body: JSON.stringify({
            model: cfg.ollamaModel,
            messages,
            stream: false,
            keep_alive: `${Math.max(1, Math.round(cfg.idleUnloadSeconds / 60))}m`,
            options: {
              temperature: 0.1,
              num_predict: 1024
            }
          })
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Lỗi gọi Ollama nội bộ (HTTP ${res.status}): ${body}`);
        }

        const json = (await res.json()) as { message?: { content?: string } };
        rawContent = json.message?.content ?? '';
      } else {
        const managedBase = await this.deps.ensureManagedEndpoint();
        const baseUrl = assertLocalhostUrl(managedBase);
        const completionsUrl = new URL('/v1/chat/completions', baseUrl);
        assertLocalhostUrl(completionsUrl.toString());

        const customName = cfg.customGgufPath ? path.basename(cfg.customGgufPath) : '';
        const modelIdentifier = `${cfg.modelPreset} ${customName}`.trim();
        modelLabel =
          cfg.modelPreset === 'custom-gguf' && customName
            ? `Local GGUF (${customName})`
            : `Local GGUF (${cfg.modelPreset})`;

        const messages = buildTranslationMessages(trimmed, modelIdentifier);

        const res = await fetch(completionsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          redirect: 'error',
          signal: abortSignal,
          body: JSON.stringify({
            messages,
            temperature: 0.1,
            max_tokens: 1024,
            stream: false
          })
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Lỗi gọi llama-server nội bộ (HTTP ${res.status}): ${body}`);
        }

        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        rawContent = json.choices?.[0]?.message?.content ?? '';
      }

      this.deps.onActivity?.();

      const translation = cleanModelOutput(rawContent);
      if (!translation && rawContent.trim()) {
        throw new Error('Model chỉ sinh thẻ suy luận rỗng, vui lòng thử lại hoặc rút ngắn câu.');
      }
      if (translation) {
        this.cache.set(trimmed, translation);
      }

      return {
        source: trimmed,
        translation,
        fromCache: false,
        latencyMs: Date.now() - startTime,
        modelLabel
      };
    } finally {
      this.deps.onRequestEnd?.();
    }
  }
}
