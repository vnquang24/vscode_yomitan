import * as dns from 'node:dns';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

// Force IPv4 first to avoid WSL2 IPv6 timeout delays
dns.setDefaultResultOrder('ipv4first');

const DATA_DIR = path.resolve('data');
const TMP_DIR = path.resolve('tmp/dict-src');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const KANJIDIC_VN_URL =
  'https://github.com/trungnt2910/KanjiDictVN/releases/download/trungnt2910.hannom.20251225-154650.kanjidic2.2025-345/KANJIDIC_vietnamese.zip';
const STARDICT_IDX_URL =
  'https://raw.githubusercontent.com/dynamotn/stardict-vi/master/ja-vi/star_nhatviet.idx';
const STARDICT_DICT_URL =
  'https://raw.githubusercontent.com/dynamotn/stardict-vi/master/ja-vi/star_nhatviet.dict';

// Curated high-frequency IT / Software Engineering Japanese-Vietnamese entries (high score = 200)
const CURATED_IT_TERMS = [
  ['仕様', 'しよう', ['đặc tả kỹ thuật (specification); quy cách'], 200, 'SĨ DẠNG'],
  ['仕様書', 'しようしょ', ['tài liệu đặc tả (specification document)'], 200, 'SĨ DẠNG THƯ'],
  ['要件定義', 'ようけんていぎ', ['định nghĩa yêu cầu (requirement definition)'], 200, 'YẾU KIỆN ĐỊNH NGHĨA'],
  ['基本設計', 'きほんせっけい', ['thiết kế cơ bản (basic design)'], 200, 'CƠ BẢN THIẾT KẾ'],
  ['詳細設計', 'しょうさいせっけい', ['thiết kế chi tiết (detailed design)'], 200, 'TƯỜNG TẾ THIẾT KẾ'],
  ['実装', 'じっそう', ['triển khai code; cài đặt (implementation)'], 200, 'THỰC TRANG'],
  ['単体テスト', 'たんたいてすと', ['kiểm thử đơn vị (unit test)'], 200, 'ĐƠN THỂ'],
  ['結合テスト', 'けつごうてすと', ['kiểm thử tích hợp (integration test)'], 200, 'KẾT HỢP'],
  ['不具合', 'ふぐあい', ['lỗi phần mềm; trục trặc (bug / defect)'], 200, 'BẤT CỤ HỢP'],
  ['改修', 'かいしゅう', ['chỉnh sửa, nâng cấp phần mềm (modification / fix)'], 200, 'CẢI TU'],
  ['修正', 'しゅうせい', ['sửa lỗi, hiệu chỉnh (fix / correction)'], 200, 'TU CHÍNH'],
  ['認証', 'にんしょう', ['xác thực danh tính (authentication)'], 200, 'NHẬN CHỨNG'],
  ['認証情報', 'にんしょうじょうほう', ['thông tin xác thực (credentials)'], 210, 'NHẬN CHỨNG TÌNH BÁO'],
  ['認可', 'にんか', ['phân quyền truy cập (authorization)'], 200, 'NHẬN KHẢ'],
  ['権限', 'けんげん', ['quyền hạn (permission / privilege)'], 200, 'QUYỀN HẠN'],
  ['環境変数', 'かんきょうへんすう', ['biến môi trường (environment variable)'], 200, 'HOÀN CẢNH BIẾN SỐ'],
  ['本番環境', 'ほんばんかんきょう', ['môi trường thật (production environment)'], 200, 'BẢN PHIÊN HOÀN CẢNH'],
  ['検証環境', 'けんしょうかんきょう', ['môi trường kiểm thử (staging / verification env)'], 200, 'KIỂM CHỨNG HOÀN CẢNH'],
  ['開発環境', 'かいはつかんきょう', ['môi trường phát triển (development environment)'], 200, 'KHAI PHÁT HOÀN CẢNH'],
  ['引数', 'ひきすう', ['tham số truyền vào hàm (argument / parameter)'], 200, 'DẪN SỐ'],
  ['戻り値', 'もどりち', ['giá trị trả về của hàm (return value)'], 200, 'LỆ TRỊ'],
  ['返り値', 'かえりち', ['giá trị trả về (return value)'], 200, 'PHẢN TRỊ'],
  ['例外', 'れいがい', ['ngoại lệ (exception)'], 200, 'LỆ NGOẠI'],
  ['初期化', 'しょきか', ['khởi tạo (initialization)'], 200, 'SƠ KỲ HÓA'],
  ['非同期', 'ひどうき', ['bất đồng bộ (asynchronous)'], 200, 'PHI ĐỒNG KỲ'],
  ['同期処理', 'どうきしょり', ['xử lý đồng bộ (synchronous processing)'], 200, 'ĐỒNG KỲ XỬ LÝ'],
  ['排他制御', 'はいたせいぎょ', ['kiểm soát loại trừ tương hỗ / khóa đồng thời (mutex / concurrency lock)'], 200, 'BÀI THA CHẾ NGỰ'],
  ['冪等性', 'べきとうせい', ['tính lũy đẳng (idempotency)'], 200, 'MỊCH ĐẲNG TÍNH'],
  ['閾値', 'しきいち', ['ngưỡng giới hạn (threshold)'], 200, 'NGƯỠNG TRỊ'],
  ['再現手順', 'さいげんてじゅん', ['các bước tái hiện lỗi (steps to reproduce)'], 200, 'TÁI HIỆN THỦ THUẬN'],
  ['暫定対応', 'ざんていたいおう', ['xử lý tạm thời (workaround / temporary fix)'], 200, 'TẠM ĐỊNH ĐỐI ỨNG'],
  ['恒久対応', 'こうきゅうたいおう', ['xử lý triệt để / lâu dài (permanent fix)'], 200, 'HẰNG CỬU ĐỐI ỨNG'],
  ['指摘事項', 'してきじこう', ['điểm được chỉ ra cần sửa khi review (review comment / finding)'], 200, 'CHỈ TRÍCH SỰ HẠNG'],
  ['納期', 'のうき', ['thời hạn bàn giao (delivery deadline)'], 200, 'NẠP KỲ'],
  ['見積もり', 'みつもり', ['ước lượng công sức / báo giá (estimation)'], 200, 'KIẾN TÍCH']
];

async function downloadIfMissing(url, destPath) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
    console.log(`[skip] Already downloaded: ${path.basename(destPath)}`);
    return;
  }
  console.log(`[download] Fetching ${url} ...`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  console.log(`[ok] Saved ${path.basename(destPath)} (${(buf.length / 1048576).toFixed(2)} MB)`);
}

function parseStarDict(idxBuf, dictBuf) {
  const entries = [];
  let pos = 0;

  while (pos < idxBuf.length) {
    // Null-terminated UTF-8 word
    let zeroIdx = pos;
    while (zeroIdx < idxBuf.length && idxBuf[zeroIdx] !== 0) {
      zeroIdx++;
    }
    if (zeroIdx + 9 > idxBuf.length) break;

    const headword = idxBuf.subarray(pos, zeroIdx).toString('utf8').trim();
    const offset = idxBuf.readUInt32BE(zeroIdx + 1);
    const size = idxBuf.readUInt32BE(zeroIdx + 5);
    pos = zeroIdx + 9;

    if (!headword || offset + size > dictBuf.length) continue;

    const rawDef = dictBuf.subarray(offset, offset + size).toString('utf8');
    const lines = rawDef
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    let reading = '';
    const glosses = [];

    for (const line of lines) {
      // @headword [reading] or @headword 【reading】
      if (line.startsWith('@')) {
        const rdMatch = line.match(/[【\[{]([^】\]}]+)[】\]}]/);
        if (rdMatch && !reading) {
          reading = rdMatch[1].trim();
        }
        continue;
      }
      // OVDP star_nhatviet stores kana reading on its own line as "{にんしょう}"
      const pureBraceReading = line.match(/^[-*\s]*\{([\u3040-\u30FFー・\s,、]+)\}\s*$/);
      if (pureBraceReading) {
        if (!reading) {
          reading = pureBraceReading[1].split(/[,、]/)[0].trim();
        }
        continue;
      }
      if (line.startsWith('*')) {
        const posLabel = line.replace(/^\*+\s*/, '').trim();
        if (posLabel) {
          glosses.push(`(${posLabel})`);
        }
        continue;
      }
      if (line.startsWith('-')) {
        const g = line
          .replace(/^-+\s*/, '')
          .replace(/^\{([^}]+)\}\s*,\s*/, '[$1] ')
          .trim();
        if (g) glosses.push(g);
        continue;
      }
      if (line.startsWith('=')) {
        // Keep max 1 short example to keep bundle compact & hover readable
        if (glosses.length < 4) {
          const ex = line.replace(/^=+\s*/, '').replace(/\+/g, '→ ').trim();
          if (ex && ex.length <= 80) {
            glosses.push(`VD: ${ex}`);
          }
        }
        continue;
      }
      if (glosses.length < 5) {
        const cleanedLine = line.replace(/^\{([^}]+)\}\s*,\s*/, '[$1] ').trim();
        if (cleanedLine) glosses.push(cleanedLine);
      }
    }

    if (glosses.length > 0) {
      // Compact multiple short lines into max 5 crisp gloss strings
      const merged = [];
      let pendingPos = '';
      for (const g of glosses) {
        if (g.startsWith('(') && g.endsWith(')') && g.length < 35) {
          pendingPos = g;
        } else if (pendingPos) {
          merged.push(`${pendingPos} ${g}`);
          pendingPos = '';
        } else {
          merged.push(g);
        }
        if (merged.length >= 5) break;
      }
      if (merged.length > 0) {
        entries.push([headword, reading || headword, merged, 50]);
      }
    }
  }

  return entries;
}

const kanjidicZipPath = path.join(DATA_DIR, 'KANJIDIC_vietnamese.zip');
const idxPath = path.join(TMP_DIR, 'star_nhatviet.idx');
const dictPath = path.join(TMP_DIR, 'star_nhatviet.dict');

await Promise.all([
  downloadIfMissing(KANJIDIC_VN_URL, kanjidicZipPath),
  downloadIfMissing(STARDICT_IDX_URL, idxPath),
  downloadIfMissing(STARDICT_DICT_URL, dictPath)
]);

console.log('[parse] Parsing StarDict OVDP Japanese-Vietnamese dictionary...');
const idxBuf = fs.readFileSync(idxPath);
const dictBuf = fs.readFileSync(dictPath);
const ovdpTerms = parseStarDict(idxBuf, dictBuf);
console.log(`[parse] Extracted ${ovdpTerms.length} Japanese-Vietnamese term entries!`);

const bundle = {
  title: 'Từ điển Nhật - Việt (OVDP & IT Glossary)',
  terms: [...CURATED_IT_TERMS, ...ovdpTerms]
};

const outGzPath = path.join(DATA_DIR, 'javi-dict.json.gz');
const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8'), {
  level: 9
});
fs.writeFileSync(outGzPath, compressed);
console.log(
  `[done] Wrote ${outGzPath} (${(compressed.length / 1048576).toFixed(2)} MB, total terms: ${bundle.terms.length})`
);
