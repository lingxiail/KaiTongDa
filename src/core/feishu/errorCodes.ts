export const FEISHU_ERROR_CODES = {
  NODE_MISSING: 'feishu_node_missing',
  CLI_UNAVAILABLE: 'feishu_cli_unavailable',
  APP_CREDENTIALS_MISSING: 'feishu_app_credentials_missing',
  AUTH_REQUIRED: 'feishu_auth_required',
  AUTH_PENDING: 'feishu_auth_pending',
  AUTH_EXPIRED: 'feishu_auth_expired',
  AUTH_TIMEOUT: 'feishu_auth_timeout',
  APPROVAL_REQUIRED: 'feishu_approval_required',
  PERMISSION_DENIED: 'feishu_permission_denied',
  RESOURCE_NOT_FOUND: 'feishu_resource_not_found',
  FIELD_MISMATCH: 'feishu_field_mismatch',
  WRITE_FAILED: 'feishu_write_failed',
  UNKNOWN: 'feishu_unknown',
} as const;

export type FeishuErrorCode = typeof FEISHU_ERROR_CODES[keyof typeof FEISHU_ERROR_CODES];
