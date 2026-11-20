export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = [
  'Bạn là chuyên gia biên dịch tiếng Nhật sang tiếng Việt trong lĩnh vực phần mềm (IT) và văn bản tổng quát.',
  'Quy tắc bắt buộc:',
  '1. Chỉ trả về đúng bản dịch tiếng Việt tự nhiên, chuẩn xác về ngữ cảnh kỹ thuật và kính ngữ.',
  '2. Không giải thích, không thêm lời mở đầu hay ghi chú, không lặp lại câu gốc tiếng Nhật.',
  '3. Giữ nguyên tên biến, tên hàm, mã lỗi hoặc từ khóa lập trình tiếng Anh nếu có trong câu.'
].join('\n');

export function buildTranslationMessages(
  japaneseText: string,
  modelIdentifier = ''
): ChatMessage[] {
  const isQwen3 = modelIdentifier.toLowerCase().includes('qwen3');
  const suffix = isQwen3 ? ' /no_think' : '';

  return [
    {
      role: 'system',
      content: SYSTEM_PROMPT
    },
    {
      role: 'user',
      content: `Dịch sang tiếng Việt:\n${japaneseText.trim()}${suffix}`
    }
  ];
}

export function cleanModelOutput(rawOutput: string): string {
  let cleaned = rawOutput
    // Strip closed <think>...</think> blocks
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    // Strip unclosed <think>... if generation stopped early
    .replace(/<think>[\s\S]*$/gi, '')
    .trim();

  // Strip optional markdown code fences or leading "Bản dịch:" label
  cleaned = cleaned
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/^(?:bản dịch(?:\s*tiếng việt)?|dịch)\s*[:：]\s*/i, '')
    .trim();

  return cleaned;
}
