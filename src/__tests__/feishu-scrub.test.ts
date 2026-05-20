import { describe, expect, it } from 'vitest';
import { normalizeFeishuCliError } from '../core/feishu/errorNormalizer';
import { scrubFeishuRawResult, scrubFeishuText } from '../core/feishu/scrub';

describe('Feishu scrub', () => {
  it('redacts token, email and phone from free-form text', () => {
    const output = scrubFeishuText(
      'Bearer abc123456\nemail=tom@example.com\nphone=13800138000\napp_secret=secret_demo',
    );

    expect(output).toContain('Bearer [REDACTED]');
    expect(output).toContain('[REDACTED_EMAIL]');
    expect(output).toContain('[REDACTED_PHONE]');
    expect(output).toContain('app_secret=[REDACTED]');
    expect(output).not.toContain('tom@example.com');
    expect(output).not.toContain('13800138000');
    expect(output).not.toContain('secret_demo');
  });

  it('redacts stdout and stderr in raw result wrappers', () => {
    const raw = scrubFeishuRawResult({
      command: 'lark-cli auth status',
      stdout: 'user_access_token: token_demo',
      stderr: 'contact tom@example.com',
      code: 1,
    });

    expect(raw.stdout).toContain('[REDACTED]');
    expect(raw.stderr).toContain('[REDACTED_EMAIL]');
  });

  it('returns scrubbed unknown errors to user-facing messages', () => {
    const normalized = normalizeFeishuCliError(
      'request failed, app_secret=secret_demo, email=tom@example.com',
    );

    expect(normalized.message).toContain('[REDACTED]');
    expect(normalized.message).toContain('[REDACTED_EMAIL]');
    expect(normalized.message).not.toContain('secret_demo');
    expect(normalized.message).not.toContain('tom@example.com');
  });
});
