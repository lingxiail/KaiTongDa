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

export type FeishuCompatibilityStatus = 'compatible' | 'untested' | 'unknown';

export interface FeishuCliCompatibility {
  status: FeishuCompatibilityStatus;
  detectedVersion?: string | null;
  supportedRange: string;
  message: string;
}

export interface FeishuEnvironmentStatus {
  nodeAvailable: boolean;
  npxAvailable: boolean;
  cliAvailable: boolean;
  nodeVersion?: string | null;
  npxVersion?: string | null;
  cliVersion?: string | null;
  compatibility?: FeishuCliCompatibility;
  installCommand?: string;
  canAutoInstall?: boolean;
  failureReason?:
    | 'node_missing'
    | 'npx_missing'
    | 'cli_missing'
    | 'network_error'
    | 'incompatible_version'
    | 'unknown';
  message: string;
}

export interface FeishuPagedResult<T> {
  items: T[];
  pageToken?: string | null;
  hasMore: boolean;
  total?: number;
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

export interface FeishuListBasesInput {
  appId?: string;
  folderToken?: string;
  pageSize?: number;
  pageToken?: string;
  refresh?: boolean;
}

export interface FeishuListTablesInput {
  appId?: string;
  baseId: string;
  pageSize?: number;
  pageToken?: string;
  refresh?: boolean;
}

export interface FeishuGetTableSchemaInput {
  appId?: string;
  baseId: string;
  tableId: string;
  pageSize?: number;
  pageToken?: string;
  refresh?: boolean;
}

export interface FeishuRecordSortRule {
  fieldName: string;
  desc?: boolean;
}

export interface FeishuQueryRecordsInput {
  appId?: string;
  baseId: string;
  tableId: string;
  filter?: Record<string, unknown>;
  sort?: FeishuRecordSortRule[];
  viewId?: string;
  fieldNames?: string[];
  pageSize?: number;
  pageToken?: string;
}

export interface FeishuRecordWriteFailure {
  index: number;
  reason: string;
}

export type FeishuWriteAction = 'create' | 'upsert' | 'update_by_filter';

export interface FeishuWriteConfirmation {
  required: boolean;
  confirmed: boolean;
  reason?: string;
  threshold?: number;
}

export interface FeishuWriteAuditSummary {
  action: FeishuWriteAction;
  baseId: string;
  tableId: string;
  successCount: number;
  failureCount: number;
  createdCount?: number;
  updatedCount?: number;
  matchedCount?: number;
  timestamp: number;
}

export interface FeishuRecordWriteResult {
  success: boolean;
  action: FeishuWriteAction;
  baseId: string;
  tableId: string;
  successCount: number;
  failureCount: number;
  createdCount?: number;
  updatedCount?: number;
  matchedCount?: number;
  failures: FeishuRecordWriteFailure[];
  message: string;
  confirmation?: FeishuWriteConfirmation;
  audit?: FeishuWriteAuditSummary;
}

export interface FeishuCreateRecordsInput {
  appId?: string;
  baseId: string;
  tableId: string;
  records: Array<Record<string, unknown>>;
  confirmed?: boolean;
}

export interface FeishuUpsertRecordsInput extends FeishuCreateRecordsInput {
  matchByFields: string[];
}

export interface FeishuUpdateRecordsByFilterInput {
  appId?: string;
  baseId: string;
  tableId: string;
  filter: Record<string, unknown>;
  fields: Record<string, unknown>;
  confirmed?: boolean;
}

export interface FeishuRecentContext {
  appId?: string;
  baseId?: string;
  baseName?: string;
  tableId?: string;
  tableName?: string;
  fieldNames?: string[];
  intent?: string;
  updatedAt: number;
}

export interface FeishuConnectInput {
  appId?: string;
  appSecret?: string;
  domain?: string;
  preferredScopes?: string[];
  interactive?: boolean;
  confirmInstall?: boolean;
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
  appSecret?: string;
  domain?: string;
  preferredScopes?: string[];
  connection?: FeishuConnectionStatus | null;
  activeLogin?: FeishuPersistedLoginState | null;
  cachedBases?: FeishuPagedResult<FeishuBaseSummary> | null;
  cachedTables?: Record<string, FeishuPagedResult<FeishuTableSummary>>;
  cachedSchemas?: Record<string, FeishuPagedResult<FeishuFieldSchema>>;
  recentContext?: FeishuRecentContext | null;
}
