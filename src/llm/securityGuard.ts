export class SecurityViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityViolationError';
  }
}

const ALLOWED_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * Enforces 100% local loopback communication for NDA/confidential code protection.
 * Rejects any external domain, LAN IP, or non-HTTP(S) protocol.
 */
export function assertLocalhostUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SecurityViolationError(`URL LLM không hợp lệ: "${rawUrl}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SecurityViolationError(
      `Giao thức không được phép ("${parsed.protocol}"). Chỉ chấp nhận http/https nội bộ.`
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_LOOPBACK_HOSTS.has(host)) {
    throw new SecurityViolationError(
      `Chặn bảo mật: Không cho phép gửi dữ liệu tới "${parsed.hostname}". Chỉ cho phép localhost / 127.0.0.1 / [::1].`
    );
  }

  return parsed;
}
