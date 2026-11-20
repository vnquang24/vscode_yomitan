import * as dns from 'node:dns';
import * as fs from 'node:fs';
import * as path from 'node:path';

dns.setDefaultResultOrder('ipv4first');

export interface ModelPresetInfo {
  id: 'qwen2.5-3b' | 'qwen3-1.7b';
  label: string;
  fileName: string;
  sizeLabel: string;
  ramEstimate: string;
  downloadUrl: string;
  description: string;
}

export const MODEL_PRESETS: Record<'qwen2.5-3b' | 'qwen3-1.7b', ModelPresetInfo> = {
  'qwen2.5-3b': {
    id: 'qwen2.5-3b',
    label: 'Qwen2.5-3B-Instruct (Q4_K_M) — Khuyên dùng cho máy 16GB RAM',
    fileName: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    sizeLabel: '~1.98 GB',
    ramEstimate: '~2.1 GB RAM khi dịch (0 MB khi nghỉ)',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
    description:
      'Cân bằng tốt nhất giữa tốc độ (~30-40 tok/s trên Core Ultra 7) và độ mượt tiếng Việt / thuật ngữ IT Nhật-Việt.'
  },
  'qwen3-1.7b': {
    id: 'qwen3-1.7b',
    label: 'Qwen3-1.7B (Q4_K_M) — Siêu nhẹ, tốc độ cao',
    fileName: 'Qwen_Qwen3-1.7B-Q4_K_M.gguf',
    sizeLabel: '~1.11 GB',
    ramEstimate: '~1.3 GB RAM khi dịch (0 MB khi nghỉ)',
    downloadUrl:
      'https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen_Qwen3-1.7B-Q4_K_M.gguf',
    description:
      'Model thế hệ mới siêu gọn nhẹ, phản hồi cực nhanh (<0.6s/câu), tự động tắt chế độ suy luận để tối ưu tốc độ dịch.'
  }
};

export interface LlamaBinaryReleaseAsset {
  tagName: string;
  assetName: string;
  downloadUrl: string;
}

export async function resolveLatestLlamaCppAsset(
  platform = process.platform,
  arch = process.arch
): Promise<LlamaBinaryReleaseAsset> {
  const res = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=3', {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'yomi-javi-vscode-extension'
    }
  });
  if (!res.ok) {
    throw new Error(`Không thể tra cứu bản phát hành llama.cpp (HTTP ${res.status}).`);
  }

  const releases = (await res.json()) as Array<{
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string }>;
  }>;

  let matcher: (name: string) => boolean;
  if (platform === 'linux' && arch === 'x64') {
    matcher = (n) => n.includes('bin-ubuntu-x64') && (n.endsWith('.tar.gz') || n.endsWith('.zip'));
  } else if (platform === 'win32' && arch === 'x64') {
    matcher = (n) => n.includes('bin-win-cpu-x64') && n.endsWith('.zip');
  } else if (platform === 'darwin' && arch === 'arm64') {
    matcher = (n) => n.includes('bin-macos-arm64') && (n.endsWith('.tar.gz') || n.endsWith('.zip'));
  } else if (platform === 'darwin' && arch === 'x64') {
    matcher = (n) => n.includes('bin-macos-x64') && (n.endsWith('.tar.gz') || n.endsWith('.zip'));
  } else {
    throw new Error(`Nền tảng ${platform}-${arch} chưa có binary tự động. Vui lòng dùng chế độ Ollama nội bộ.`);
  }

  for (const rel of releases) {
    const asset = rel.assets.find((a) => matcher(a.name));
    if (asset) {
      if (
        !asset.browser_download_url.startsWith('https://github.com/') &&
        !asset.browser_download_url.startsWith('https://objects.githubusercontent.com/')
      ) {
        throw new Error(`URL tải llama-server không thuộc nguồn GitHub tin cậy: ${asset.browser_download_url}`);
      }
      return {
        tagName: rel.tag_name,
        assetName: asset.name,
        downloadUrl: asset.browser_download_url
      };
    }
  }

  throw new Error(`Không tìm thấy gói llama-server phù hợp cho ${platform}-${arch}.`);
}

export async function downloadFileWithProgress(
  url: string,
  destPath: string,
  onProgress?: (downloadedBytes: number, totalBytes: number) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const partPath = `${destPath}.part`;

  const res = await fetch(url, {
    redirect: 'follow',
    signal: abortSignal
  });
  if (!res.ok || !res.body) {
    throw new Error(`Tải thất bại từ ${url} (HTTP ${res.status})`);
  }

  const totalBytes = Number(res.headers.get('content-length') ?? 0);
  const fileStream = fs.createWriteStream(partPath);
  let downloaded = 0;

  try {
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        downloaded += value.byteLength;
        if (!fileStream.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => fileStream.once('drain', resolve));
        }
        onProgress?.(downloaded, totalBytes);
      }
    }
    await new Promise<void>((resolve, reject) => {
      fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    fs.renameSync(partPath, destPath);
  } catch (err) {
    await new Promise<void>((resolve) => {
      fileStream.close(() => resolve());
      fileStream.destroy();
    });
    try {
      if (fs.existsSync(partPath)) {
        fs.unlinkSync(partPath);
      }
    } catch {
      // ignore EBUSY cleanup error on Windows
    }
    throw err;
  }
}
