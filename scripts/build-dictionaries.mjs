import * as dns from 'node:dns';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import JSZip from 'jszip';

dns.setDefaultResultOrder('ipv4first');

const DATA_DIR = path.resolve('data');
const TMP_DIR = path.resolve('tmp/dict-src');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const KANJIDIC_VN_URL =
  'https://github.com/trungnt2910/KanjiDictVN/releases/download/trungnt2910.hannom.20251225-154650.kanjidic2.2025-345/KANJIDIC_vietnamese.zip';

// Curated high-frequency IT / Software Engineering Japanese-Vietnamese entries (highest priority = 220)
const CURATED_IT_TERMS = [
  ['仕様', 'しよう', ['đặc tả kỹ thuật (specification); quy cách'], 220, 'SĨ DẠNG', 'IT'],
  ['仕様書', 'しようしょ', ['tài liệu đặc tả (specification document)'], 220, 'SĨ DẠNG THƯ', 'IT'],
  ['要件定義', 'ようけんていぎ', ['định nghĩa yêu cầu (requirement definition)'], 220, 'YẾU KIỆN ĐỊNH NGHĨA', 'IT'],
  ['基本設計', 'きほんせっけい', ['thiết kế cơ bản (basic design)'], 220, 'CƠ BẢN THIẾT KẾ', 'IT'],
  ['詳細設計', 'しょうさいせっけい', ['thiết kế chi tiết (detailed design)'], 220, 'TƯỜNG TẾ THIẾT KẾ', 'IT'],
  ['実装', 'じっそう', ['triển khai code; cài đặt (implementation)'], 220, 'THỰC TRANG', 'IT'],
  ['単体テスト', 'たんたいてすと', ['kiểm thử đơn vị (unit test)'], 220, 'ĐƠN THỂ', 'IT'],
  ['結合テスト', 'けつごうてすと', ['kiểm thử tích hợp (integration test)'], 220, 'KẾT HỢP', 'IT'],
  ['不具合', 'ふぐあい', ['lỗi phần mềm; trục trặc (bug / defect)'], 220, 'BẤT CỤ HỢP', 'IT'],
  ['改修', 'かいしゅう', ['chỉnh sửa, nâng cấp phần mềm (modification / fix)'], 220, 'CẢI TU', 'IT'],
  ['修正', 'しゅうせい', ['sửa lỗi, hiệu chỉnh (fix / correction)'], 220, 'TU CHÍNH', 'IT'],
  ['認証', 'にんしょう', ['xác thực danh tính (authentication)'], 220, 'NHẬN CHỨNG', 'IT'],
  ['認証情報', 'にんしょうじょうほう', ['thông tin xác thực (credentials)'], 230, 'NHẬN CHỨNG TÌNH BÁO', 'IT'],
  ['認可', 'にんか', ['phân quyền truy cập (authorization)'], 220, 'NHẬN KHẢ', 'IT'],
  ['権限', 'けんげん', ['quyền hạn (permission / privilege)'], 220, 'QUYỀN HẠN', 'IT'],
  ['環境変数', 'かんきょうへんすう', ['biến môi trường (environment variable)'], 220, 'HOÀN CẢNH BIẾN SỐ', 'IT'],
  ['本番環境', 'ほんばんかんきょう', ['môi trường thật (production environment)'], 220, 'BẢN PHIÊN HOÀN CẢNH', 'IT'],
  ['検証環境', 'けんしょうかんきょう', ['môi trường kiểm thử (staging / verification env)'], 220, 'KIỂM CHỨNG HOÀN CẢNH', 'IT'],
  ['開発環境', 'かいはつかんきょう', ['môi trường phát triển (development environment)'], 220, 'KHAI PHÁT HOÀN CẢNH', 'IT'],
  ['引数', 'ひきすう', ['tham số truyền vào hàm (argument / parameter)'], 220, 'DẪN SỐ', 'IT'],
  ['戻り値', 'もどりち', ['giá trị trả về của hàm (return value)'], 220, 'LỆ TRỊ', 'IT'],
  ['返り値', 'かえりち', ['giá trị trả về (return value)'], 220, 'PHẢN TRỊ', 'IT'],
  ['例外', 'れいがい', ['ngoại lệ (exception)'], 220, 'LỆ NGOẠI', 'IT'],
  ['初期化', 'しょきか', ['khởi tạo (initialization)'], 220, 'SƠ KỲ HÓA', 'IT'],
  ['非同期', 'ひどうき', ['bất đồng bộ (asynchronous)'], 220, 'PHI ĐỒNG KỲ', 'IT'],
  ['同期処理', 'どうきしょり', ['xử lý đồng bộ (synchronous processing)'], 220, 'ĐỒNG KỲ XỬ LÝ', 'IT'],
  ['排他制御', 'はいたせいぎょ', ['kiểm soát loại trừ tương hỗ / khóa đồng thời (mutex / concurrency lock)'], 220, 'BÀI THA CHẾ NGỰ', 'IT'],
  ['冪等性', 'べきとうせい', ['tính lũy đẳng (idempotency)'], 220, 'MỊCH ĐẲNG TÍNH', 'IT'],
  ['閾値', 'しきいち', ['ngưỡng giới hạn (threshold)'], 220, 'NGƯỠNG TRỊ', 'IT'],
  ['再現手順', 'さいげんてじゅん', ['các bước tái hiện lỗi (steps to reproduce)'], 220, 'TÁI HIỆN THỦ THUẬN', 'IT'],
  ['暫定対応', 'ざんていたいおう', ['xử lý tạm thời (workaround / temporary fix)'], 220, 'TẠM ĐỊNH ĐỐI ỨNG', 'IT'],
  ['恒久対応', 'こうきゅうたいおう', ['xử lý triệt để / lâu dài (permanent fix)'], 220, 'HẰNG CỬU ĐỐI ỨNG', 'IT'],
  ['指摘事項', 'してきじこう', ['điểm được chỉ ra cần sửa khi review (review comment / finding)'], 220, 'CHỈ TRÍCH SỰ HẠNG', 'IT'],
  ['納期', 'のうき', ['thời hạn bàn giao (delivery deadline)'], 220, 'NẠP KỲ', 'IT'],
  ['見積もり', 'みつもり', ['ước lượng công sức / báo giá (estimation)'], 220, 'KIẾN TÍCH', 'IT']
];

const IGNORED_TAGS = new Set(['rt', 'rp']);
const IGNORED_DATA = new Set([
  'attribution',
  'extra-info',
  'xref',
  'forms',
  'example-sentence',
  'info-glossary'
]);
const BLOCK_TAGS = new Set(['div', 'p', 'li', 'ul', 'ol', 'tr', 'table', 'section']);

function renderNode(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(renderNode).join('');
  if (typeof node === 'object') {
    const tag = typeof node.tag === 'string' ? node.tag.toLowerCase() : '';
    if (IGNORED_TAGS.has(tag)) return '';
    const dataContent = node.data && typeof node.data === 'object' ? node.data.content : '';
    if (dataContent && IGNORED_DATA.has(dataContent)) return '';
    if (tag === 'br') return '\n';
    const inner = renderNode(node.content);
    if (!inner) return '';
    if (dataContent === 'part-of-speech-info') return `(${inner.trim()}) `;
    if (tag === 'li') return `• ${inner.trim()}\n`;
    if (BLOCK_TAGS.has(tag)) return `${inner.trim()}\n`;
    return inner;
  }
  return '';
}

function extractGloss(item) {
  if (typeof item === 'string') return item.trim();
  if (!item || typeof item !== 'object') return '';
  if (item.type === 'image') return '';
  if (item.type === 'text' && typeof item.text === 'string') return item.text.trim();
  if (item.type === 'structured-content') return renderNode(item.content).trim();
  if ('content' in item) return renderNode(item.content).trim();
  return '';
}

async function extractYomitanZipTerms(zipPath, dictLabel, baseScore, maxGlossesPerEntry = 4) {
  console.log(`[parse] Loading ${zipPath} (${dictLabel})...`);
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const bankNames = Object.keys(zip.files)
    .filter((n) => /^term_bank_\d+\.json$/.test(path.basename(n)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const out = [];
  for (const bankName of bankNames) {
    const rows = JSON.parse(await zip.files[bankName].async('string'));
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const expression = String(row[0] ?? '').trim();
      const reading = String(row[1] ?? '').trim() || expression;
      if (!expression) continue;

      const rawGlosses = Array.isArray(row[5]) ? row[5] : [row[5]];
      const blocks = rawGlosses.map(extractGloss).filter(Boolean);
      if (blocks.length === 0) continue;

      let hanViet = '';
      const glosses = [];
      for (const block of blocks) {
        const lines = block
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length === 0) continue;

        let start = 0;
        const first = lines[0];
        if (
          !hanViet &&
          lines.length >= 2 &&
          first.length <= 45 &&
          first === first.toUpperCase() &&
          /^[\p{Script=Latin}\s,;/·-]+$/u.test(first) &&
          /\p{L}/u.test(first)
        ) {
          hanViet = first;
          start = 1;
        }

        if (start > 0) {
          for (let i = start; i < lines.length; i++) {
            const g = lines[i].replace(/^\d+\.\s*/, '').trim();
            if (g) glosses.push(g);
            if (glosses.length >= maxGlossesPerEntry) break;
          }
        } else {
          // Group structured sense bullets cleanly
          const senseLines = lines
            .join('\n')
            .replace(/\(\s*([^)]+)\s*\)\s*\n•\s*/g, '($1) ')
            .split('\n')
            .map((s) => s.replace(/^•\s*/, '').trim())
            .filter(Boolean);
          for (const sl of senseLines) {
            // Skip standalone redundant pos tag if no gloss followed
            if (/^\([^)]+\)$/.test(sl)) continue;
            glosses.push(sl);
            if (glosses.length >= maxGlossesPerEntry) break;
          }
        }
        if (glosses.length >= maxGlossesPerEntry) break;
      }

      if (glosses.length > 0) {
        out.push([expression, reading, glosses, baseScore, hanViet || undefined, dictLabel]);
      }
    }
  }
  console.log(`[ok] Extracted ${out.length} entries from ${dictLabel}`);
  return out;
}

async function downloadIfMissing(url, destPath) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
    return;
  }
  console.log(`[download] Fetching ${url} ...`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

const kanjidicZipPath = path.join(DATA_DIR, 'KANJIDIC_vietnamese.zip');
await downloadIfMissing(KANJIDIC_VN_URL, kanjidicZipPath);

const maziiZipPath = path.resolve('mazii_yomitan.zip');
const jitendexZipPath = path.resolve('jitendex-yomitan.zip');

const allTerms = [...CURATED_IT_TERMS];

if (fs.existsSync(maziiZipPath)) {
  const maziiTerms = await extractYomitanZipTerms(maziiZipPath, 'Mazii', 140, 4);
  for (const item of maziiTerms) allTerms.push(item);
}

if (fs.existsSync(jitendexZipPath)) {
  const jitendexTerms = await extractYomitanZipTerms(jitendexZipPath, 'Jitendex', 60, 3);
  for (const item of jitendexTerms) allTerms.push(item);
}

const bundle = {
  title: 'Mazii (Nhật-Việt) & Jitendex Yomitan',
  terms: allTerms
};

const outGzPath = path.join(DATA_DIR, 'javi-dict.json.gz');
const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8'), {
  level: 9
});
fs.writeFileSync(outGzPath, compressed);
console.log(
  `[done] Wrote ${outGzPath} (${(compressed.length / 1048576).toFixed(2)} MB, total terms: ${bundle.terms.length})`
);
