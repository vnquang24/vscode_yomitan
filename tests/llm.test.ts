import { describe, expect, it, afterEach } from 'vitest';
import * as http from 'node:http';
import { assertLocalhostUrl, SecurityViolationError } from '../src/llm/securityGuard.js';
import { TranslationCache } from '../src/llm/translationCache.js';
import { buildTranslationMessages, cleanModelOutput } from '../src/llm/promptBuilder.js';
import { LlmTranslator } from '../src/llm/llmTranslator.js';
import {
  resolveSafeExtractPath,
  needsLinuxLibgomp
} from '../src/llm/llamaServerManager.js';

describe('securityGuard (NDA 100% localhost enforcement)', () => {
  it('allows loopback addresses (127.0.0.1, localhost, [::1])', () => {
    expect(assertLocalhostUrl('http://127.0.0.1:11434/api/chat').hostname).toBe('127.0.0.1');
    expect(assertLocalhostUrl('http://localhost:8080/v1/chat/completions').hostname).toBe('localhost');
    expect(assertLocalhostUrl('http://[::1]:11434').hostname).toBe('[::1]');
  });

  it('blocks external cloud domains, LAN IPs, and spoofed subdomains', () => {
    expect(() => assertLocalhostUrl('https://api.openai.com/v1/chat/completions')).toThrow(
      SecurityViolationError
    );
    expect(() => assertLocalhostUrl('http://127.0.0.1.attacker.com:8080')).toThrow(
      SecurityViolationError
    );
    expect(() => assertLocalhostUrl('http://192.168.1.20:11434')).toThrow(
      SecurityViolationError
    );
  });

  it('prevents Zip Slip path traversal (including Windows backslashes) when extracting archive entries', () => {
    expect(() => resolveSafeExtractPath('/tmp/llama-bin', '../../etc/cron.d/pwn')).toThrow(
      SecurityViolationError
    );
    expect(() => resolveSafeExtractPath('/tmp/llama-bin', '..\\..\\Windows\\win.ini')).toThrow(
      SecurityViolationError
    );
    expect(resolveSafeExtractPath('/tmp/llama-bin', 'build/bin/llama-server')).toBe(
      '/tmp/llama-bin/build/bin/llama-server'
    );
  });

  it('rejects URLs containing embedded credentials even on 127.0.0.1', () => {
    expect(() => assertLocalhostUrl('http://user:secret@127.0.0.1:11434')).toThrow(
      SecurityViolationError
    );
  });

  it('detects missing libgomp.so.1 in Linux ldd output', () => {
    const missingLdd = '\tlibstdc++.so.6 => /usr/lib/libstdc++.so.6\n\tlibgomp.so.1 => not found\n';
    const okLdd = '\tlibgomp.so.1 => /usr/lib/x86_64-linux-gnu/libgomp.so.1 (0x00007f)\n';
    expect(needsLinuxLibgomp(missingLdd)).toBe(true);
    expect(needsLinuxLibgomp(okLdd)).toBe(false);
  });
});

describe('TranslationCache (LRU)', () => {
  it('caches translations and evicts least-recently-used item when full', () => {
    const cache = new TranslationCache(2);
    cache.set('認証エラー', 'Lỗi xác thực');
    cache.set('接続失敗', 'Kết nối thất bại');

    // Touch first key so second becomes LRU
    expect(cache.get('認証エラー')).toBe('Lỗi xác thực');

    cache.set('タイムアウト', 'Hết thời gian chờ');
    expect(cache.get('接続失敗')).toBeUndefined();
    expect(cache.get('認証エラー')).toBe('Lỗi xác thực');
    expect(cache.get('タイムアウト')).toBe('Hết thời gian chờ');
  });
});

describe('promptBuilder & cleanModelOutput', () => {
  it('appends /no_think directive for Qwen3 models to eliminate thinking latency', () => {
    const msgs = buildTranslationMessages('この機能はまだ実装されていません。', 'qwen3-1.7b');
    const userMsg = msgs.find((m) => m.role === 'user')!;
    expect(userMsg.content).toContain('/no_think');
    expect(userMsg.content).toContain('この機能はまだ実装されていません。');
  });

  it('strips <think>...</think> blocks and wrapper quotes cleanly', () => {
    const dirty =
      '<think>\nLet us translate this IT sentence carefully.\n</think>\n\nTính năng này vẫn chưa được triển khai.';
    expect(cleanModelOutput(dirty)).toBe('Tính năng này vẫn chưa được triển khai.');
  });
});

describe('LlmTranslator (local HTTP inference, caching & security block)', () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  it('translates via local OpenAI-compatible server, cleans <think>, and serves second call from 0ms cache', async () => {
    let requestCount = 0;
    server = http.createServer((req, res) => {
      requestCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '<think>reasoning</think>\nVui lòng kiểm tra thông tin xác thực.'
              }
            }
          ]
        })
      );
    });

    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number };

    const translator = new LlmTranslator({
      getConfig: () => ({
        backend: 'managed-llama',
        ollamaEndpoint: 'http://127.0.0.1:11434',
        ollamaModel: 'qwen2.5:3b',
        modelPreset: 'qwen2.5-3b',
        idleUnloadSeconds: 300
      }),
      ensureManagedEndpoint: async () => `http://127.0.0.1:${address.port}`
    });

    const first = await translator.translate('認証情報を確認してください。');
    expect(first.translation).toBe('Vui lòng kiểm tra thông tin xác thực.');
    expect(first.fromCache).toBe(false);
    expect(requestCount).toBe(1);

    const second = await translator.translate('認証情報を確認してください。');
    expect(second.translation).toBe('Vui lòng kiểm tra thông tin xác thực.');
    expect(second.fromCache).toBe(true);
    expect(requestCount).toBe(1);
  });

  it('refuses to send Japanese source text if ollamaEndpoint points outside localhost', async () => {
    const translator = new LlmTranslator({
      getConfig: () => ({
        backend: 'ollama',
        ollamaEndpoint: 'https://evil-cloud.example.com',
        ollamaModel: 'qwen2.5:3b',
        modelPreset: 'qwen2.5-3b',
        idleUnloadSeconds: 300
      }),
      ensureManagedEndpoint: async () => 'http://127.0.0.1:9999'
    });

    await expect(translator.translate('機密コードのコメント')).rejects.toThrow(
      SecurityViolationError
    );
  });

  it('blocks HTTP 307 redirect exfiltration from localhost to external server and passes customGgufPath for Qwen3 /no_think', async () => {
    let seenPrompt = '';
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (body.includes('リダイレクトテスト')) {
          res.writeHead(307, { Location: 'https://attacker.example.com/steal' });
          res.end();
          return;
        }
        seenPrompt = body;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'Đã dịch an toàn.' } }] }));
      });
    });

    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number };

    const translator = new LlmTranslator({
      getConfig: () => ({
        backend: 'managed-llama',
        ollamaEndpoint: 'http://127.0.0.1:11434',
        ollamaModel: 'qwen2.5:3b',
        modelPreset: 'custom-gguf',
        customGgufPath: '/models/Qwen3-1.7B-Q4_K_M.gguf',
        idleUnloadSeconds: 300
      }),
      ensureManagedEndpoint: async () => `http://127.0.0.1:${address.port}`
    });

    // 1. Redirect must fail instead of following to external host
    await expect(translator.translate('リダイレクトテスト')).rejects.toThrow();

    // 2. Custom GGUF with Qwen3 in filename must receive /no_think
    const ok = await translator.translate('正常なテスト');
    expect(ok.translation).toBe('Đã dịch an toàn.');
    expect(seenPrompt).toContain('/no_think');
  });
});
