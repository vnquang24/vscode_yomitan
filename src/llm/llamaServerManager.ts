import { spawn, execFile, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import {
  downloadFileWithProgress,
  resolveLatestLlamaCppAsset
} from './modelCatalog.js';
import { SecurityViolationError } from './securityGuard.js';

const execFileAsync = promisify(execFile);

export function resolveSafeExtractPath(rootDir: string, relativeEntryPath: string): string {
  const normalizedRel = relativeEntryPath.replace(/\\/g, '/');
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(resolvedRoot, normalizedRel);
  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(resolvedRoot + path.sep)
  ) {
    throw new SecurityViolationError(
      `Chặn giải nén đường dẫn không an toàn (Zip Slip): "${relativeEntryPath}"`
    );
  }
  return resolvedTarget;
}

export type LlamaServerState = 'stopped' | 'starting' | 'ready';

export interface LlamaServerOptions {
  storageDir: string;
  modelPath: string;
  threads: number;
  idleUnloadSeconds: number;
  onStateChange?: (state: LlamaServerState, detail?: string) => void;
}

export class LlamaServerManager {
  private proc: ChildProcess | null = null;
  private port: number | null = null;
  private activeModelPath: string | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private startingPromise: Promise<string> | null = null;
  private installingPromise: Promise<string> | null = null;
  private stopGeneration = 0;
  private activeRequests = 0;
  private state: LlamaServerState = 'stopped';

  constructor(private readonly storageDir: string) {}

  getState(): LlamaServerState {
    return this.state;
  }

  beginRequest(): void {
    this.activeRequests++;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  endRequest(
    idleUnloadSeconds: number,
    onStateChange?: (state: LlamaServerState, detail?: string) => void
  ): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    if (this.activeRequests === 0 && this.proc) {
      this.resetIdleTimer(idleUnloadSeconds, onStateChange);
    }
  }

  getBinaryPath(): string | null {
    const binDir = path.join(this.storageDir, 'llama-bin');
    const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    return findFileRecursive(binDir, exeName);
  }

  async ensureBinaryInstalled(
    onProgress?: (msg: string, pct?: number) => void,
    abortSignal?: AbortSignal
  ): Promise<string> {
    const existing = this.getBinaryPath();
    if (existing) return existing;
    if (this.installingPromise) return this.installingPromise;

    this.installingPromise = (async () => {
      try {
        onProgress?.('Đang kiểm tra phiên bản llama-server chính thức...');
        const asset = await resolveLatestLlamaCppAsset();
        const binRoot = path.join(this.storageDir, 'llama-bin');
        fs.mkdirSync(binRoot, { recursive: true });
        const archivePath = path.join(binRoot, asset.assetName);

        await downloadFileWithProgress(
          asset.downloadUrl,
          archivePath,
          (loaded, total) => {
            const pct = total > 0 ? Math.round((loaded / total) * 100) : undefined;
            onProgress?.(`Đang tải engine llama-server (${(loaded / 1048576).toFixed(1)} MB)...`, pct);
          },
          abortSignal
        );

        onProgress?.('Đang giải nén llama-server...');
        if (asset.assetName.endsWith('.tar.gz')) {
          await execFileAsync('tar', ['--no-same-owner', '-xzf', archivePath, '-C', binRoot]);
        } else if (asset.assetName.endsWith('.zip')) {
          const zip = await JSZip.loadAsync(fs.readFileSync(archivePath));
          for (const [relPath, entry] of Object.entries(zip.files)) {
            const outPath = resolveSafeExtractPath(binRoot, relPath);
            if (entry.dir) {
              fs.mkdirSync(outPath, { recursive: true });
            } else {
              fs.mkdirSync(path.dirname(outPath), { recursive: true });
              fs.writeFileSync(outPath, await entry.async('nodebuffer'));
            }
          }
        }
        try {
          fs.unlinkSync(archivePath);
        } catch {
          // ignore
        }

        const found = this.getBinaryPath();
        if (!found) {
          throw new Error('Đã giải nén nhưng không tìm thấy thực thi llama-server.');
        }
        if (process.platform !== 'win32') {
          fs.chmodSync(found, 0o755);
        }
        return found;
      } finally {
        this.installingPromise = null;
      }
    })();

    return this.installingPromise;
  }

  async ensureStarted(opts: LlamaServerOptions): Promise<string> {
    if (!fs.existsSync(opts.modelPath)) {
      throw new Error(
        `Chưa có file model GGUF tại "${opts.modelPath}". Hãy chạy lệnh "Yomi Ja-Vi: Tải Small LLM Offline" trước.`
      );
    }

    if (this.proc && this.port && this.activeModelPath === opts.modelPath && this.state === 'ready') {
      return `http://127.0.0.1:${this.port}`;
    }

    if (this.startingPromise) {
      const url = await this.startingPromise;
      if (this.activeModelPath === opts.modelPath && this.proc) {
        return url;
      }
    }

    await this.stop(opts.onStateChange);
    const launchGen = this.stopGeneration;

    this.startingPromise = (async () => {
      let child: ChildProcess | null = null;
      try {
        this.setState('starting', opts.onStateChange, 'Đang nạp model vào RAM...');
        const binPath = this.getBinaryPath();
        if (!binPath) {
          throw new Error(
            'Chưa cài đặt engine llama-server. Hãy chạy lệnh "Yomi Ja-Vi: Tải Small LLM Offline" để tự động cài đặt.'
          );
        }

        const freePort = await getEphemeralLoopbackPort();
        if (this.stopGeneration !== launchGen) {
          throw new Error('Đã hủy khởi động llama-server.');
        }

        const binDir = path.dirname(binPath);
        let spawnErr: Error | null = null;

        child = spawn(
          binPath,
          [
            '--host',
            '127.0.0.1',
            '--port',
            String(freePort),
            '-m',
            opts.modelPath,
            '-t',
            String(opts.threads),
            '-c',
            '2048',
            '--no-webui'
          ],
          {
            cwd: binDir,
            env: {
              ...process.env,
              LD_LIBRARY_PATH: `${binDir}:${process.env.LD_LIBRARY_PATH ?? ''}`,
              DYLD_LIBRARY_PATH: `${binDir}:${process.env.DYLD_LIBRARY_PATH ?? ''}`
            },
            // Ignore stdout so OS 64KB pipe buffer never deadlocks llama-server request logging!
            stdio: ['ignore', 'ignore', 'pipe']
          }
        );

        child.on('error', (err) => {
          spawnErr = err;
        });

        let stderrTail = '';
        child.stderr?.on('data', (chunk: Buffer) => {
          stderrTail = (stderrTail + chunk.toString('utf8')).slice(-1200);
        });

        child.on('exit', () => {
          if (this.proc === child) {
            this.proc = null;
            this.port = null;
            this.activeModelPath = null;
            this.setState('stopped', opts.onStateChange, 'Idle (0 MB RAM)');
          }
        });

        this.proc = child;
        this.port = freePort;
        this.activeModelPath = opts.modelPath;

        const baseUrl = `http://127.0.0.1:${freePort}`;
        await waitForServerReady(baseUrl, child, () => spawnErr, () => stderrTail);

        if (this.stopGeneration !== launchGen) {
          await this.stop(opts.onStateChange);
          throw new Error('Đã hủy khởi động llama-server.');
        }

        this.setState('ready', opts.onStateChange, path.basename(opts.modelPath));
        if (this.activeRequests === 0) {
          this.resetIdleTimer(opts.idleUnloadSeconds, opts.onStateChange);
        }
        return baseUrl;
      } catch (err) {
        if (child && this.proc !== child) {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
        await this.stop(opts.onStateChange);
        throw err;
      } finally {
        this.startingPromise = null;
      }
    })();

    return this.startingPromise;
  }

  resetIdleTimer(
    idleUnloadSeconds: number,
    onStateChange?: (state: LlamaServerState, detail?: string) => void
  ): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.activeRequests > 0) {
      return;
    }
    this.idleTimer = setTimeout(() => {
      if (this.activeRequests === 0) {
        void this.stop(onStateChange);
      }
    }, Math.max(30, idleUnloadSeconds) * 1000);
  }

  async stop(onStateChange?: (state: LlamaServerState, detail?: string) => void): Promise<void> {
    this.stopGeneration++;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.proc) {
      this.setState('stopped', onStateChange, 'Idle (0 MB RAM)');
      return;
    }

    const p = this.proc;
    this.proc = null;
    this.port = null;
    this.activeModelPath = null;

    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          p.kill('SIGKILL');
        } catch {
          // ignore
        }
        resolve();
      }, 2000);

      p.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });

      try {
        p.kill('SIGTERM');
      } catch {
        clearTimeout(killTimer);
        resolve();
      }
    });

    this.setState('stopped', onStateChange, 'Đã giải phóng RAM');
  }

  private setState(
    next: LlamaServerState,
    cb?: (state: LlamaServerState, detail?: string) => void,
    detail?: string
  ): void {
    this.state = next;
    cb?.(next, detail);
  }
}

function findFileRecursive(dir: string, targetName: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === targetName) {
      return full;
    }
    if (entry.isDirectory()) {
      const sub = findFileRecursive(full, targetName);
      if (sub) return sub;
    }
  }
  return null;
}

function getEphemeralLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServerReady(
  baseUrl: string,
  child: ChildProcess,
  getSpawnErr: () => Error | null,
  getStderr: () => string,
  timeoutMs = 45000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const spawnErr = getSpawnErr();
    if (spawnErr) {
      throw new Error(`Không thể chạy llama-server: ${spawnErr.message}`);
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `llama-server dừng sớm (code=${child.exitCode}, signal=${child.signalCode}): ${getStderr()}`
      );
    }
    try {
      const res = await fetch(`${baseUrl}/health`, { redirect: 'error' });
      if (res.ok) {
        return;
      }
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Quá thời gian khởi động llama-server (${timeoutMs}ms): ${getStderr()}`);
}
