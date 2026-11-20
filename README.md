# Yomi Ja-Vi — Từ điển Hover Yomitan & Small Local LLM (Nhật – Việt)

Extension VS Code giúp đọc code, comment và tài liệu dự án tiếng Nhật **an toàn bảo mật 100% (NDA / Offline)**:
- **Di chuột tra từ kiểu Yomitan (< 5ms):** Hiện từ gốc, cách đọc **Kana (Hiragana)**, **Âm Hán-Việt**, khử chia động từ/tính từ (`実装されていません` → `実装`), nghĩa tiếng Việt (tích hợp sẵn **172.000+ mục từ Nhật–Việt** + **KanjiDictVN**), không chèn chữ làm rối trình soạn thảo.
- **Hỗ trợ chuẩn Yomitan `.zip`:** Có thể import bất kỳ bộ từ điển `.zip` Yomitan v3 nào qua lệnh `Yomi Ja-Vi: Import từ điển Yomitan (.zip)`.
- **Dịch câu bằng Small Local LLM (100% Localhost):**
  - Tối ưu riêng cho máy **Intel Core Ultra 7 / 16GB RAM**: mặc định khuyên dùng **`Qwen2.5-3B-Instruct (Q4_K_M ~1.98 GB)`** hoặc bản siêu nhẹ **`Qwen3-1.7B (Q4_K_M ~1.11 GB)`**.
  - **Không tốn RAM khi nghỉ:** Tự động tắt tiến trình `llama-server` và trả lại 100% RAM sau 5 phút không dịch, kèm bộ nhớ đệm LRU (`0ms` cho câu đã dịch).
  - **Chốt chặn bảo mật cứng (`securityGuard`):** Mọi yêu cầu dịch chỉ được phép đi qua `127.0.0.1` / `localhost`, chặn tuyệt đối kết nối ra internet.

## Cách cài đặt & sử dụng nhanh

1. Cài đặt file đóng gói `.vsix`:
   ```bash
   code --install-extension yomi-javi-0.1.0.vsix
   ```
   *(Hoặc mở thư mục này trong VS Code và nhấn `F5` để chạy thử ngay trong cửa sổ Extension Development Host).*

2. **Tra từ Yomitan ngay lập tức:** Mở bất kỳ file code/markdown nào có chữ tiếng Nhật và **di chuột vào chữ Kanji/Kana** — từ điển 172k từ và Hán-Việt đã đóng gói sẵn bên trong, không cần tải thêm.

3. **Kích hoạt AI dịch câu Offline (chỉ cần làm 1 lần):**
   - Mở Command Palette (`Ctrl+Shift+P`) → chọn **`Yomi Ja-Vi: Tải Small LLM Offline (Qwen2.5-3B / Qwen3-1.7B)`** (hoặc chọn file `.gguf` có sẵn trên máy / kết nối Ollama nội bộ `http://127.0.0.1:11434`).
   - Khi đọc code, bấm **`[🤖 Dịch câu này (Local LLM)]`** ngay trong popup Hover, hoặc bôi đen đoạn tiếng Nhật và nhấn **`Ctrl+Shift+Y`**.
