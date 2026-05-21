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

  if (includesAny(merged, ['expired', 'token expired', 'invalid_grant', 'invalid access token'])) {
    return {
      errorCode: FEISHU_ERROR_CODES.AUTH_EXPIRED,
      message: '当前飞书授权已过期。',
      nextAction: '请重新执行 feishu_connect，并通过授权链接完成确认。',
    };
  }

  if (includesAny(merged, ['approval', 'approve', '审批', 'admin consent', 'administrator'])) {
    return {
      errorCode: FEISHU_ERROR_CODES.APPROVAL_REQUIRED,
      message: '当前授权仍需管理员或企业侧审批。',
      nextAction: '请联系企业管理员完成审批，审批通过后调用 feishu_auth_status 查询状态。',
    };
  }

  if (includesAny(merged, ['scope', 'permission denied', 'forbidden', '403', 'no permission', 'permission scope'])) {
    return {
      errorCode: FEISHU_ERROR_CODES.PERMISSION_DENIED,
      message: '当前账号或应用权限不足。',
      nextAction: '请检查应用权限配置并重新授权。',
    };
  }

  if (includesAny(merged, ['not found', '404', 'resource not found', 'base not found', 'table not found', 'record not found'])) {
    return {
      errorCode: FEISHU_ERROR_CODES.RESOURCE_NOT_FOUND,
      message: '未找到指定的飞书资源。',
      nextAction: '请确认 Base、Table、Record ID 是否正确，并确保当前账号有访问权限。',
    };
  }

  if (includesAny(merged, ['field mismatch', 'invalid field', 'unknown field', '字段', 'field_name'])) {
    return {
      errorCode: FEISHU_ERROR_CODES.FIELD_MISMATCH,
      message: '飞书字段结构不匹配。',
      nextAction: '请先调用 feishu_get_table_schema 检查字段名称和类型，再重试。',
    };
  }

  if (includesAny(merged, ['network', 'econn', 'fetch failed', 'connection reset', 'dns', 'proxy', 'tls'])) {
    return {
      errorCode: FEISHU_ERROR_CODES.CLI_UNAVAILABLE,
      message: '连接飞书服务时发生网络错误。',
      nextAction: '请检查网络、代理或企业防火墙后重试。',
    };
  }

  if (includesAny(merged, ['version', 'upgrade', 'update lark-cli', 'outdated', 'too old'])) {
    return {
      errorCode: FEISHU_ERROR_CODES.CLI_UNAVAILABLE,
      message: '当前 lark-cli 版本过旧或不兼容。',
      nextAction: '请执行 lark-cli update 或重新安装最新版 lark-cli 后重试。',
    };
  }

  if (includesAny(merged, ['timeout', 'timed out'])) {
    return {
      errorCode: FEISHU_ERROR_CODES.AUTH_TIMEOUT,
      message: '等待飞书授权完成超时。',
      nextAction: '请打开授权链接完成确认，或调用 feishu_auth_status 查询当前授权状态。',
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
