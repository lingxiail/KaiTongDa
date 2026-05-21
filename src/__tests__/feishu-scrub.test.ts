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
      command: 'lark-cli auth login --app-secret secret_demo -s secret_demo',
      stdout: 'user_access_token: token_demo',
      stderr: 'contact tom@example.com and 13800138000',
      code: 1,
    });

    expect(raw.command).not.toContain('secret_demo');
    expect(raw.stdout).toContain('[REDACTED]');
    expect(raw.stderr).toContain('[REDACTED_EMAIL]');
    expect(raw.stderr).toContain('[REDACTED_PHONE]');
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

  it('normalizes common actionable failures', () => {
    expect(normalizeFeishuCliError('admin approval required').errorCode).toBe('feishu_approval_required');
    expect(normalizeFeishuCliError('permission denied: missing scope').errorCode).toBe('feishu_permission_denied');
    expect(normalizeFeishuCliError('token expired').errorCode).toBe('feishu_auth_expired');
    expect(normalizeFeishuCliError('network fetch failed').errorCode).toBe('feishu_cli_unavailable');
    expect(normalizeFeishuCliError('lark-cli version too old').errorCode).toBe('feishu_cli_unavailable');
    expect(normalizeFeishuCliError('base not found').errorCode).toBe('feishu_resource_not_found');
    expect(normalizeFeishuCliError('invalid field field_name').errorCode).toBe('feishu_field_mismatch');
  });
});
