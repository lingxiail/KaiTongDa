import { FEISHU_ERROR_CODES, type FeishuErrorCode } from './errorCodes';
import { scrubFeishuText } from './scrub';
import type { FeishuConnectionStatus } from './types';

function includesAny(source: string, tokens: string[]): boolean {
  const lower = source.toLowerCase();
  return tokens.some((token) => lower.includes(token.toLowerCase()));
}

export function normalizeFeishuCliError(stderr: string, stdout = ''): {
  errorCode: FeishuErrorCode;
  message: string;
  nextAction: string;
} {
  const merged = `${stdout}\n${stderr}`.trim();
  const scrubbed = scrubFeishuText(merged);

  if (includesAny(merged, ['expired', 'token expired', 'invalid_grant'])) {
    return {
      errorCode: FEISHU_ERROR_CODES.AUTH_EXPIRED,
      message: '当前飞书授权已过期。',
      nextAction: '请重新执行连接授权。',
    };
  }

  if (includesAny(merged, ['approval', 'approve', '审批'])) {
    return {
      errorCode: FEISHU_ERROR_CODES.APPROVAL_REQUIRED,
      message: '当前授权仍需管理员或企业侧审批。',
      nextAction: '请等待审批通过后重试。',
    };
  }

  if (includesAny(merged, ['scope', 'permission denied', 'forbidden', '403'])) {
    return {
      errorCode: FEISHU_ERROR_CODES.PERMISSION_DENIED,
      message: '当前账号或应用权限不足。',
      nextAction: '请检查应用权限配置并重新授权。',
    };
  }

  if (includesAny(merged, ['timeout', 'timed out'])) {
    return {
      errorCode: FEISHU_ERROR_CODES.AUTH_TIMEOUT,
      message: '等待飞书授权完成超时。',
      nextAction: '请重新发起授权，并在浏览器或飞书客户端完成确认。',
    };
  }

  return {
    errorCode: FEISHU_ERROR_CODES.UNKNOWN,
    message: scrubbed || '飞书操作失败。',
    nextAction: '请查看错误详情并重试。',
  };
}

export function withNormalizedFailure(
  status: Omit<FeishuConnectionStatus, 'errorCode' | 'message' | 'nextAction'>,
  stderr: string,
  stdout = '',
): FeishuConnectionStatus {
  const normalized = normalizeFeishuCliError(stderr, stdout);
  return {
    ...status,
    message: normalized.message,
    nextAction: normalized.nextAction,
    errorCode: normalized.errorCode,
  };
}
