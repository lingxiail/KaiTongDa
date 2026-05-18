import type { FeishuCliAdapter, FeishuCliRawResult } from './cliAdapter';
import { feishuCliAdapter } from './cliAdapter';
import { FeishuAuthService, feishuAuthService } from './authService';
import { FeishuSessionStore, feishuSessionStore } from './sessionStore';
import type {
  FeishuBaseSummary,
  FeishuFieldSchema,
  FeishuGetTableSchemaInput,
  FeishuListBasesInput,
  FeishuListTablesInput,
  FeishuPagedResult,
  FeishuQueryRecordsInput,
  FeishuRecordQueryResult,
  FeishuTableSummary,
} from './types';

// 1. 容错JSON解析（兼容飞书不规范的返回值）
function parseJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  try {
    return JSON.parse(trimmed);
  } catch {
    const arrayStart = trimmed.indexOf('[');
    const objectStart = trimmed.indexOf('{');
    const start = arrayStart === -1 ? objectStart : objectStart === -1 ? arrayStart : Math.min(arrayStart, objectStart);
    const end = Math.max(trimmed.lastIndexOf(']'), trimmed.lastIndexOf('}'));
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(`无法解析飞书返回结果: ${trimmed}`);
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function pickBoolean(source: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number') {
      return value;
    }
  }
  return undefined;
}

// 4.  unwrap 嵌套数据（提取飞书返回的 data 字段）
function unwrapData(payload: unknown): Record<string, unknown> {
  const objectPayload = asObject(payload);
  const nested = objectPayload.data;
  return Object.keys(asObject(nested)).length > 0 ? asObject(nested) : objectPayload;
}

function extractItems(container: Record<string, unknown>): unknown[] {
  const candidates = [
    container.items,
    container.files,
    container.records,
    container.tables,
    container.fields,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function toPagedResult<T>(payload: unknown, mapper: (item: Record<string, unknown>) => T | null): FeishuPagedResult<T> {
  const data = unwrapData(payload);
  const items = extractItems(data)
    .map((item) => mapper(asObject(item)))
    .filter((item): item is T => item !== null);

  return {
    items,
    pageToken: pickString(data, ['page_token', 'pageToken', 'next_page_token']) ?? null,
    hasMore: pickBoolean(data, ['has_more', 'hasMore']) ?? false,
    total: pickNumber(data, ['total', 'total_count']),
  };
}

function normalizeBase(item: Record<string, unknown>): FeishuBaseSummary | null {
  const type = pickString(item, ['type', 'file_type', 'obj_type']);
  const id = pickString(item, ['app_token', 'appToken', 'token', 'file_token']);
  if (!id) return null;
  if (type && type !== 'bitable') return null;

  return {
    id,
    name: pickString(item, ['name', 'title']) || id,
    url: pickString(item, ['url', 'open_url', 'link']),
  };
}

function normalizeTable(baseId: string, item: Record<string, unknown>): FeishuTableSummary | null {
  const id = pickString(item, ['table_id', 'tableId', 'id']);
  if (!id) return null;
  return {
    id,
    name: pickString(item, ['name']) || id,
    baseId,
  };
}

function normalizeField(item: Record<string, unknown>): FeishuFieldSchema | null {
  const fieldId = pickString(item, ['field_id', 'fieldId', 'id']);
  const fieldName = pickString(item, ['field_name', 'fieldName', 'name']);
  if (!fieldId || !fieldName) return null;

  const property = asObject(item.property);
  const options = asArray(property.options).map((option) => pickString(asObject(option), ['name'])).filter(Boolean) as string[];

  return {
    fieldId,
    fieldName,
    fieldType: pickString(item, ['type', 'ui_type']) || 'unknown',
    writable: pickBoolean(item, ['is_writable', 'writable']) ?? !item.is_primary,
    required: pickBoolean(item, ['required', 'is_required']),
    options: options.length > 0 ? options : undefined,
  };
}

function normalizeRecord(item: Record<string, unknown>): Record<string, unknown> {
  const fields = asObject(item.fields);
  const recordId = pickString(item, ['record_id', 'recordId', 'id']);
  return recordId ? { recordId, ...fields } : fields;
}

function ensureRawSuccess(raw: FeishuCliRawResult): void {
  if (raw.code !== 0) {
    throw new Error(raw.stderr || raw.stdout || '飞书请求失败。');
  }
}

export class FeishuBaseService {
  constructor(
    private readonly adapter: FeishuCliAdapter = feishuCliAdapter,
    private readonly authService: FeishuAuthService = feishuAuthService,
    private readonly store: FeishuSessionStore = feishuSessionStore,
  ) {}

  private async ensureConnected(appId?: string): Promise<void> {
    const status = await this.authService.checkAuthStatus({ appId });
    if (!status.connected) {
      throw new Error(status.message || '当前尚未建立飞书连接，请先执行 feishu_connect。');
    }
  }

  async listBases(input: FeishuListBasesInput = {}): Promise<FeishuPagedResult<FeishuBaseSummary>> {
    await this.ensureConnected(input.appId);
    if (!input.refresh && !input.pageToken) {
      const cached = this.store.getCachedBases(input.appId);
      if (cached) return cached;
    }

    const raw = await this.adapter.listBases(input);
    ensureRawSuccess(raw);
    const result = toPagedResult(parseJsonPayload(raw.stdout), normalizeBase);
    if (!input.pageToken) {
      this.store.setCachedBases(input.appId, result);
    }
    return result;
  }

  async listTables(input: FeishuListTablesInput): Promise<FeishuPagedResult<FeishuTableSummary>> {
    await this.ensureConnected(input.appId);
    if (!input.refresh && !input.pageToken) {
      const cached = this.store.getCachedTables(input.appId, input.baseId);
      if (cached) return cached;
    }

    const raw = await this.adapter.listTables(input);
    ensureRawSuccess(raw);
    const result = toPagedResult(parseJsonPayload(raw.stdout), (item) => normalizeTable(input.baseId, item));
    if (!input.pageToken) {
      this.store.setCachedTables(input.appId, input.baseId, result);
    }
    return result;
  }

  async getTableSchema(input: FeishuGetTableSchemaInput): Promise<FeishuPagedResult<FeishuFieldSchema>> {
    await this.ensureConnected(input.appId);
    if (!input.refresh && !input.pageToken) {
      const cached = this.store.getCachedSchema(input.appId, input.baseId, input.tableId);
      if (cached) return cached;
    }

    const raw = await this.adapter.getTableSchema(input);
    ensureRawSuccess(raw);
    const result = toPagedResult(parseJsonPayload(raw.stdout), normalizeField);
    if (!input.pageToken) {
      this.store.setCachedSchema(input.appId, input.baseId, input.tableId, result);
    }
    return result;
  }

  async queryRecords(input: FeishuQueryRecordsInput): Promise<FeishuRecordQueryResult> {
    await this.ensureConnected(input.appId);
    const raw = await this.adapter.queryRecords(input);
    ensureRawSuccess(raw);

    const data = unwrapData(parseJsonPayload(raw.stdout));
    const records = extractItems(data).map((item) => normalizeRecord(asObject(item)));

    return {
      records,
      pageToken: pickString(data, ['page_token', 'pageToken', 'next_page_token']) ?? null,
      hasMore: pickBoolean(data, ['has_more', 'hasMore']) ?? false,
      total: pickNumber(data, ['total', 'total_count']),
    };
  }
}

export const feishuBaseService = new FeishuBaseService();
