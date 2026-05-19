import type { FeishuConnectionStatus, FeishuFieldSchema, FeishuRecentContext } from './types';

export type FeishuIntentKind =
  | 'connect'
  | 'auth_status'
  | 'list_bases'
  | 'list_tables'
  | 'get_table_schema'
  | 'query_records'
  | 'write_request'
  | 'unknown';

export interface FeishuIntentSlot {
  name: 'appId' | 'appSecret' | 'baseId' | 'baseName' | 'tableId' | 'tableName' | 'fieldNames' | 'limit' | 'filter';
  value: unknown;
  source: 'query' | 'context' | 'cache';
}

export interface FeishuIntent {
  kind: FeishuIntentKind;
  confidence: 'high' | 'medium' | 'low';
  query: string;
  slots: FeishuIntentSlot[];
  missingSlots: string[];
}

export interface FeishuResolvedBase {
  id: string;
  name: string;
}

export interface FeishuResolvedTable {
  id: string;
  name: string;
  baseId: string;
}

export interface FeishuResourceCandidate {
  id: string;
  name: string;
  type: 'base' | 'table' | 'field';
  baseId?: string;
}

export interface FeishuIntentContext {
  appId?: string;
  authStatus?: FeishuConnectionStatus;
  recentContext?: FeishuRecentContext | null;
  base?: FeishuResolvedBase;
  table?: FeishuResolvedTable;
  fieldSchemas?: FeishuFieldSchema[];
  candidates?: FeishuResourceCandidate[];
  missingSlots?: string[];
}

export interface FeishuExecutionStep {
  type: 'check_auth' | 'connect' | 'list_bases' | 'list_tables' | 'get_table_schema' | 'query_records' | 'clarify';
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
  status: 'pending' | 'completed' | 'skipped';
}

export interface FeishuExecutionPlan {
  intent: FeishuIntentKind;
  steps: FeishuExecutionStep[];
}

export interface FeishuHandleRequestInput {
  query: string;
  appId?: string;
  appSecret?: string;
  domain?: string;
  conversationContext?: Record<string, unknown>;
}

export interface FeishuHandleRequestResult {
  intent: FeishuIntent;
  resolvedContext: FeishuIntentContext;
  needClarification: boolean;
  clarificationQuestion?: string;
  executionPlan: FeishuExecutionPlan;
  result?: unknown;
  message: string;
}
