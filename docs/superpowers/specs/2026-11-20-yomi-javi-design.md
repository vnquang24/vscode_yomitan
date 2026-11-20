# Yomi Ja-Vi — Thiết kế VS Code Extension (Yomitan Nhật–Việt & Small Local LLM)

## 1. Mục tiêu & Lý do (Intent & Why)
Xây dựng extension VS Code giúp lập trình viên làm việc với dự án/tài liệu tiếng Nhật có thể:
1. **Di chuột tra từ tức thời kiểu Yomitan** (hiện Kana, âm Hán-Việt, khử chia động từ/tính từ, nghĩa tiếng Việt, phân tích từng chữ Kanji) mà **không chèn chữ Kana làm rối trình soạn thảo**.
2. **Dịch câu/đoạn văn Nhật → Việt bằng Small LLM chạy hoàn toàn nội bộ (100% Localhost/Offline)** nhằm đảm bảo **bảo mật tuyệt đối (NDA)**, không gửi bất kỳ dòng code hay tài liệu nào ra internet, đồng thời không gây lag hay chiếm RAM lâu dài trên cấu hình laptop (Intel Core Ultra 7 165H, 16GB RAM).

## 2. Goals, Non-Goals & Anti-Goals
- **Goals:**
  - Phản hồi Hover từ điển dưới `10ms`, `0% CPU` khi nghỉ.
  - Đóng gói sẵn dữ liệu từ điển Nhật–Việt (~80.000+ mục từ từ OVDP + từ vựng IT tiếng Nhật) và Hán tự Hán-Việt (`KanjiDictVN`), đồng thời hỗ trợ import thêm file `.zip` chuẩn Yomitan v3 bất kỳ.
  - Tích hợp Small Local LLM (`Qwen2.5-3B-Instruct Q4_K_M` ~1.9GB làm mặc định cân bằng chất lượng/RAM cho máy 16GB, kèm tùy chọn nhẹ `Qwen3-1.7B Q4_K_M` ~1.1GB) chạy qua tiến trình `llama-server` độc lập hoặc Ollama nội bộ, có tự động giải phóng RAM sau 5 phút không dùng và bộ nhớ đệm LRU.
- **Non-Goals:**
  - Không hiển thị Furigana/Kana trực tiếp trong màn hình code editor (`InlayHints` / `TextEditorDecoration`).
  - Không tích hợp dịch vụ đám mây bên thứ ba (Google Translate, OpenAI Cloud, DeepL API).
- **Anti-Goals (Thất bại nếu xảy ra):**
  - Rò rỉ bất kỳ dữ liệu văn bản nào ra khỏi `127.0.0.1` / `localhost` / `::1`.
  - Gọi LLM tự động mỗi lần rê chuột khiến CPU tăng tải liên tục hoặc treo luồng Extension Host.

## 3. Kiến trúc & Lựa chọn kỹ thuật
- **Ngôn ngữ & Đóng gói:** TypeScript + `esbuild` (không phụ thuộc native `.node` addon để tương thích mọi phiên bản Electron của VS Code trên WSL2, Linux, Windows, macOS).
- **Tầng Từ điển & Phân tích hình thái (`src/japanese`, `src/dictionary`):**
  - Bộ khử chia từ tiếng Nhật (`Deinflector`) dựa trên tập luật hậu tố chuẩn Yomitan kết hợp `kuromoji` để xác định ranh giới từ tại con trỏ và lấy cách đọc Hiragana cho cả từ chưa có trong từ điển.
  - Dữ liệu từ điển nén `gzip` (`data/javi-dict.json.gz`) + `data/KANJIDIC_vietnamese.zip` nạp lười (lazy load) ở lần tra đầu tiên.
- **Tầng Small Local LLM (`src/llm`):**
  - **Managed `llama-server` Backend (mặc định, không cần cài ngoài/sudo):** Tự động tải binary chính thức `ggml-org/llama.cpp` theo hệ điều hành và model `.gguf` vào `globalStorageUri`, chạy ở cổng nội bộ `127.0.0.1:<port>`, tự tắt tiến trình sau `300s` nhàn rỗi để trả lại 100% RAM.
  - **Ollama Local Backend (tùy chọn):** Kết nối `http://127.0.0.1:11434` nếu máy đã chạy sẵn Ollama.
  - **Security Guard:** Mọi HTTP request dịch thuật đều đi qua `assertLocalhostUrl(url)` — từ chối cứng mọi domain ngoài loopback.
- **Tầng Giao diện VS Code (`src/ui`):**
  - `HoverProvider`: Hiển thị thẻ tra từ Yomitan + âm Hán-Việt + kết quả dịch câu từ Cache (hoặc link lệnh `[🤖 Dịch câu này (Local LLM)]`).
  - `WebviewViewProvider` (Sidebar **Yomi Ja-Vi**): Khung tra cứu & dịch đoạn văn có streaming theo thời gian thực, quản lý tải model / giải phóng RAM / import Yomitan `.zip`.
