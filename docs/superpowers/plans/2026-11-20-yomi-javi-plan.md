# Yomi Ja-Vi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with strict TDD. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng hoàn chỉnh extension VS Code `yomi-javi` mang trải nghiệm tra từ Hover kiểu Yomitan (Nhật–Việt, Kana, Hán-Việt) và dịch câu bằng Small Local LLM bảo mật 100% offline.

**Architecture:** Tách biệt rõ lõi xử lý thuần TypeScript (không phụ thuộc API `vscode` để kiểm thử TDD 100% bằng Vitest) gồm 3 module `japanese`, `dictionary`, `llm`, và tầng giao diện VS Code (`ui/hoverProvider`, `ui/sidebarProvider`, `extension.ts`). Model dịch mặc định là `Qwen2.5-3B-Instruct-Q4_K_M` chạy qua tiến trình con `llama-server` gắn chặt vào `127.0.0.1` (hoặc Ollama nội bộ), tự giải phóng RAM khi nhàn rỗi.

**Tech Stack:** TypeScript 5, VS Code Extension API (`^1.90.0`), `kuromoji`, `jszip`, `esbuild`, `vitest`, `@vscode/vsce`.

**Spec:** `docs/superpowers/specs/2026-11-20-yomi-javi-design.md`

## Global Constraints
- Không hiển thị Kana/Furigana inline trên màn hình trình soạn thảo (`InlayHints` / `TextEditorDecoration`).
- Tuyệt đối không gửi request mạng tới host ngoài `127.0.0.1`, `localhost`, `::1` khi dịch văn bản (chỉ tải model/từ điển khi người dùng chủ động chạy lệnh tải).
- Không dùng native C++ `.node` addon trong tiến trình Extension Host.

## Review Focus
- Con trỏ chuột đặt ở giữa một từ ghép Kanji (ví dụ ký tự `証` trong `認証情報`) vẫn phải nhận diện được từ ghép đầy đủ `認証情報` bên cạnh từ con.
- Câu tiếng Nhật nằm trong comment code (`// 認証情報を確認する`, `/* ... */`, `# ...`) hoặc chuỗi JSON/string (`"エラーが発生しました"`) phải tách sạch ký tự cú pháp code trước khi đưa vào dịch câu.
- Khi người dùng cấu hình nhầm endpoint LLM sang domain ngoài (ví dụ `https://api.openai.com`), `securityGuard` phải chặn ngay lập tức và báo lỗi bảo mật rõ ràng.
- File `.zip` Yomitan v3 có định nghĩa dạng `structured-content` lồng nhau (mảng/object đệ quy) phải trích xuất ra văn bản phẳng sạch sẽ, không hiện `[object Object]`.
- Model `Qwen3` nếu được chọn có thể sinh thẻ `<think>...</think>` gây chậm và bẩn bản dịch: bộ lọc đầu ra và prompt phải khử sạch `<think>...</think>`.

---

### Task 1: Khởi tạo dự án, cấu hình Build & Test
- [ ] Khởi tạo `git`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `esbuild.mjs`, `.vscodeignore` và cài đặt dependencies.

### Task 2: Xử lý văn bản tiếng Nhật, Kana & Khử chia từ (Deinflector)
- [ ] Viết test `tests/japanese.test.ts` kiểm tra chuyển Katakana→Hiragana, trích xuất cụm chữ Nhật & câu sạch quanh con trỏ trong comment code, và khử chia động từ/tính từ phức hợp (`食べさせられた` → `食べる`, `実装されていません` → `実装する`, `高くない` → `高い`).
- [ ] Cài đặt `src/japanese/kana.ts`, `src/japanese/deinflector.ts`, `src/japanese/textExtractor.ts` và `src/japanese/analyzer.ts`.

### Task 3: Từ điển Yomitan `.zip`, Hán-Việt & Dữ liệu Nhật–Việt Offline
- [ ] Viết test `tests/dictionary.test.ts` kiểm tra đọc Yomitan `.zip` (cả chuỗi thường lẫn `structured-content`), tra cứu từ dài nhất kết hợp `Deinflector`, và ghép âm Hán-Việt cho từ ghép Kanji.
- [ ] Cài đặt `src/dictionary/yomitanLoader.ts` và `src/dictionary/dictionaryStore.ts`.
- [ ] Viết và chạy `scripts/build-dictionaries.mjs` tải `KANJIDIC_vietnamese.zip` và biên dịch từ điển Nhật–Việt OVDP + từ vựng IT sang `data/javi-dict.json.gz`.

### Task 4: Dịch thuật bằng Small Local LLM (Bảo mật, Cache & Quản lý RAM)
- [ ] Viết test `tests/llm.test.ts` kiểm tra `assertLocalhostUrl`, `TranslationCache` (LRU), `buildTranslationMessages` + `cleanModelOutput` (lọc `<think>`), và luồng dịch qua HTTP local mock + tự động unload sau idle timeout.
- [ ] Cài đặt `src/llm/securityGuard.ts`, `src/llm/translationCache.ts`, `src/llm/promptBuilder.ts`, `src/llm/modelCatalog.ts`, `src/llm/llamaServerManager.ts`, `src/llm/llmTranslator.ts`.

### Task 5: Giao diện VS Code (`HoverProvider`, Sidebar Webview, Commands & Status Bar)
- [ ] Viết test `tests/hoverFormatter.test.ts` kiểm tra định dạng Markdown của thẻ Hover Yomitan (tiêu đề, Kana, Hán-Việt, nghĩa, phân tích Kanji, câu đã dịch hoặc command URI an toàn).
- [ ] Cài đặt `src/ui/hoverFormatter.ts`, `src/ui/hoverProvider.ts`, `src/ui/sidebarProvider.ts`, `src/extension.ts`.

### Task 6: Kiểm thử toàn diện & Đóng gói `.vsix`
- [ ] Chạy toàn bộ unit + integration tests, kiểm tra kiểu TypeScript, bundle production bằng `esbuild`, và xuất file `yomi-javi-0.1.0.vsix`.
