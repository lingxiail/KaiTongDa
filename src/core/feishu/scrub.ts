import type { FeishuCommandRawResult } from './connectorAdapter';

const REDACTED = '[REDACTED]';
const REDACTED_EMAIL = '[REDACTED_EMAIL]';
const REDACTED_PHONE = '[REDACTED_PHONE]';

const SECRET_PATTERNS = [
  /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+\b/gi,
  /\b(app[_ -]?secret|access[_ -]?token|tenant_access_token|user_access_token|refresh[_ -]?token|token|secret)\b(["']?\s*[:=]\s*["']?)([^"'\s,}]+)/gi,
];

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g;

export function scrubFeishuText(input: string): string {
  if (!input) {
    return input;
  }

  let next = input;
  next = next.replace(SECRET_PATTERNS[0], `$1 ${REDACTED}`);
  next = next.replace(SECRET_PATTERNS[1], (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`);
  next = next.replace(EMAIL_PATTERN, REDACTED_EMAIL);
  next = next.replace(PHONE_PATTERN, REDACTED_PHONE);
  return next;
}

export function scrubFeishuRawResult(result: FeishuCommandRawResult): FeishuCommandRawResult {
  return {
    ...result,
    stdout: scrubFeishuText(result.stdout),
    stderr: scrubFeishuText(result.stderr),
  };
}
