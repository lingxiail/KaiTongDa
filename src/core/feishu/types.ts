import type { FeishuErrorCode } from './errorCodes';

export type FeishuAuthState =
  | 'unauthorized'
  | 'connected'
  | 'auth_expired'
  | 'approval_pending';

export type FeishuLoginPhase =
  | 'idle'
  | 'checking_environment'
  | 'starting_auth'
  | 'waiting_user_confirm'
  | 'verifying_session'
  | 'connected'
  | 'approval_pending'
  | 'auth_expired'
  | 'failed';

export interface FeishuAccountSummary {
  openId?: string;
  unionId?: string;
  userId?: string;
  name?: string;
  enName?: string;
  email?: string;
  avatarUrl?: string;
}

export interface FeishuTenantSummary {
  tenantKey?: string;
  tenantName?: string;
  tenantId?: string;
}

export interface FeishuConnectionStatus {
  success: boolean;
  connected: boolean;
  state: FeishuAuthState;
  phase: FeishuLoginPhase;
  message: string;
  nextAction?: string;
  errorCode?: FeishuErrorCode;
  appId?: string;
  domain?: string;
  account?: FeishuAccountSummary | null;
  tenant?: FeishuTenantSummary | null;
  authUrl?: string;
  expiresAt?: number | null;
  lastUpdatedAt: number;
}

export interface FeishuEnvironmentStatus {
  nodeAvailable: boolean;
  cliAvailable: boolean;
  nodeVersion?: string | null;
  cliVersion?: string | null;
  message: string;
}

export interface FeishuBaseSummary {
  id: string;
  name: string;
  url?: string;
}

export interface FeishuTableSummary {
  id: string;
  name: string;
  baseId: string;
}

export interface FeishuFieldSchema {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  writable: boolean;
  required?: boolean;
  options?: string[];
}

export interface FeishuRecordQueryResult {
  records: Array<Record<string, unknown>>;
  pageToken?: string | null;
  hasMore: boolean;
  total?: number;
}

export interface FeishuRecordWriteFailure {
  index: number;
  reason: string;
}

export interface FeishuRecordWriteResult {
  successCount: number;
  failureCount: number;
  createdCount?: number;
  updatedCount?: number;
  matchedCount?: number;
  failures: FeishuRecordWriteFailure[];
}

export interface FeishuCreateRecordsInput {
  baseId: string;
  tableId: string;
  records: Array<Record<string, unknown>>;
}

export interface FeishuUpsertRecordsInput extends FeishuCreateRecordsInput {
  matchByFields: string[];
}

export interface FeishuUpdateRecordsByFilterInput {
  baseId: string;
  tableId: string;
  filter: string;
  fields: Record<string, unknown>;
}

export interface FeishuConnectInput {
  appId?: string;
  appSecret?: string;
  domain?: string;
  preferredScopes?: string[];
  interactive?: boolean;
  waitForMs?: number;
  port?: number;
}

export interface FeishuLoginStartInput {
  appId: string;
  appSecret: string;
  domain?: string;
  preferredScopes?: string[];
  port?: number;
  timeoutSec?: number;
}

export interface FeishuPersistedLoginState {
  id: string;
  state: FeishuAuthState;
  phase: FeishuLoginPhase;
  startedAt: number;
  timeoutAt?: number;
  message?: string;
  nextAction?: string;
  authUrl?: string;
  outputLines: string[];
}

export interface FeishuPersistedSession {
  appId?: string;
  domain?: string;
  preferredScopes?: string[];
  connection?: FeishuConnectionStatus | null;
  activeLogin?: FeishuPersistedLoginState | null;
}
