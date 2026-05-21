import type { FeishuCommandRawResult, FeishuConnectorAdapter } from './connectorAdapter';
import { larkMcpAdapter } from './larkMcpAdapter';
import { FeishuAuthService, feishuAuthService } from './authService';
import { buildFeishuWriteAuditSummary } from './audit';
import { FeishuFieldMapper, feishuFieldMapper } from './fieldMapper';
import { FeishuResultNormalizer, feishuResultNormalizer } from './resultNormalizer';
import { FeishuSessionStore, feishuSessionStore } from './sessionStore';
import { FeishuWritePolicy, feishuWritePolicy } from './writePolicy';
import { FeishuWriteQueue, feishuWriteQueue } from './writeQueue';
import type {
  FeishuBaseSummary,
  FeishuCreateRecordsInput,
  FeishuFieldSchema,
  FeishuGetTableSchemaInput,
  FeishuListBasesInput,
  FeishuListTablesInput,
  FeishuPagedResult,
  FeishuQueryRecordsInput,
  FeishuRecentContext,
  FeishuRecordQueryResult,
  FeishuRecordWriteResult,
  FeishuTableSummary,
  FeishuUpdateRecordsByFilterInput,
  FeishuUpsertRecordsInput,
} from './types';

function ensureRawSuccess(raw: FeishuCommandRawResult): void {
  if (raw.code !== 0) {
    throw new Error(raw.stderr || raw.stdout || '飞书请求失败。');
  }
}

function dedupeFieldNames(fieldNames: Array<string | undefined>): string[] | undefined {
  const normalized = fieldNames
    .filter((fieldName): fieldName is string => typeof fieldName === 'string' && fieldName.trim().length > 0)
    .map((fieldName) => fieldName.trim());
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

function collectRecordFieldNames(records: Array<Record<string, unknown>>): string[] | undefined {
  return dedupeFieldNames(records.flatMap((record) => Object.keys(record)));
}

export class FeishuBaseService {
  private readonly adapter: FeishuConnectorAdapter;
  private readonly authService: FeishuAuthService;
  private readonly store: FeishuSessionStore;
  private readonly fieldMapper: FeishuFieldMapper;
  private readonly writePolicy: FeishuWritePolicy;
  private readonly resultNormalizer: FeishuResultNormalizer;
  private readonly writeQueue: FeishuWriteQueue;

  constructor(
    adapter: FeishuConnectorAdapter = larkMcpAdapter,
    authService: FeishuAuthService = feishuAuthService,
    store: FeishuSessionStore = feishuSessionStore,
    fieldMapper: FeishuFieldMapper = feishuFieldMapper,
    writePolicy: FeishuWritePolicy = feishuWritePolicy,
    resultNormalizer: FeishuResultNormalizer = feishuResultNormalizer,
    writeQueue: FeishuWriteQueue = feishuWriteQueue,
  ) {
    this.adapter = adapter;
    this.authService = authService;
    this.store = store;
    this.fieldMapper = fieldMapper;
    this.writePolicy = writePolicy;
    this.resultNormalizer = resultNormalizer;
    this.writeQueue = writeQueue;
  }

  private async ensureConnected(appId?: string): Promise<void> {
    const status = await this.authService.checkAuthStatus({ appId });
    if (!status.connected) {
      throw new Error(status.message || '当前尚未建立飞书连接，请先执行 feishu_connect。');
    }
  }

  private getCachedBaseName(appId: string | undefined, baseId: string): string | undefined {
    return this.store.getCachedBases(appId)?.items.find((item) => item.id === baseId)?.name;
  }

  private getCachedTableName(appId: string | undefined, baseId: string, tableId: string): string | undefined {
    return this.store.getCachedTables(appId, baseId)?.items.find((item) => item.id === tableId)?.name;
  }

  private rememberRecentContext(input: {
    appId?: string;
    baseId?: string;
    baseName?: string;
    tableId?: string;
    tableName?: string;
    fieldNames?: string[];
    intent: string;
  }): void {
    const context: Partial<FeishuRecentContext> = {
      appId: input.appId,
      intent: input.intent,
      updatedAt: Date.now(),
    };

    if (input.baseId) {
      context.baseId = input.baseId;
      context.baseName = input.baseName || this.getCachedBaseName(input.appId, input.baseId) || input.baseId;
    }

    if (input.tableId && input.baseId) {
      context.tableId = input.tableId;
      context.tableName = input.tableName || this.getCachedTableName(input.appId, input.baseId, input.tableId) || input.tableId;
    }

    const fieldNames = dedupeFieldNames(input.fieldNames ?? []);
    if (fieldNames) {
      context.fieldNames = fieldNames;
    }

    if (!context.baseId && !context.tableId && !context.fieldNames?.length) {
      return;
    }

    this.store.mergeRecentContext(input.appId, context);
  }

  async listBases(input: FeishuListBasesInput = {}): Promise<FeishuPagedResult<FeishuBaseSummary>> {
    await this.ensureConnected(input.appId);
    const canUseCache = !input.folderToken && !input.refresh && !input.pageToken;
    if (canUseCache) {
      const cached = this.store.getCachedBases(input.appId);
      if (cached) return cached;
    }

    const raw = await this.adapter.listBases(input);
    ensureRawSuccess(raw);
    const result = this.resultNormalizer.toPagedResult(
      this.resultNormalizer.parseJsonPayload(raw.stdout),
      (item) => this.resultNormalizer.normalizeBase(item),
    );
    if (!input.folderToken && !input.pageToken) {
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
    const result = this.resultNormalizer.toPagedResult(
      this.resultNormalizer.parseJsonPayload(raw.stdout),
      (item) => this.resultNormalizer.normalizeTable(input.baseId, item),
    );
    if (!input.pageToken) {
      this.store.setCachedTables(input.appId, input.baseId, result);
    }
    this.rememberRecentContext({
      appId: input.appId,
      baseId: input.baseId,
      intent: 'list_tables',
    });
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
    const result = this.resultNormalizer.toPagedResult(
      this.resultNormalizer.parseJsonPayload(raw.stdout),
      (item) => this.resultNormalizer.normalizeField(item),
    );
    if (!input.pageToken) {
      this.store.setCachedSchema(input.appId, input.baseId, input.tableId, result);
    }
    this.rememberRecentContext({
      appId: input.appId,
      baseId: input.baseId,
      tableId: input.tableId,
      fieldNames: result.items.map((item) => item.fieldName),
      intent: 'get_table_schema',
    });
    return result;
  }

  async queryRecords(input: FeishuQueryRecordsInput): Promise<FeishuRecordQueryResult> {
    await this.ensureConnected(input.appId);
    const raw = await this.adapter.queryRecords(input);
    ensureRawSuccess(raw);
    const result = this.resultNormalizer.normalizeRecordQueryResult(
      this.resultNormalizer.parseJsonPayload(raw.stdout),
    );
    const cachedFieldNames = this.store
      .getCachedSchema(input.appId, input.baseId, input.tableId)
      ?.items
      .map((item) => item.fieldName);
    this.rememberRecentContext({
      appId: input.appId,
      baseId: input.baseId,
      tableId: input.tableId,
      fieldNames: input.fieldNames || cachedFieldNames || collectRecordFieldNames(result.records),
      intent: 'query_records',
    });
    return result;
  }

  private async getSchemaForWrite(input: {
    appId?: string;
    baseId: string;
    tableId: string;
  }): Promise<FeishuFieldSchema[]> {
    const schema = await this.getTableSchema({
      appId: input.appId,
      baseId: input.baseId,
      tableId: input.tableId,
    });
    return schema.items;
  }

  private withAudit(result: FeishuRecordWriteResult): FeishuRecordWriteResult {
    return {
      ...result,
      audit: buildFeishuWriteAuditSummary(result),
    };
  }

  private buildConfirmationResult(input: {
    action: FeishuRecordWriteResult['action'];
    baseId: string;
    tableId: string;
    message: string;
    threshold?: number;
  }): FeishuRecordWriteResult {
    return this.withAudit({
      success: false,
      action: input.action,
      baseId: input.baseId,
      tableId: input.tableId,
      successCount: 0,
      failureCount: 0,
      failures: [],
      message: input.message,
      confirmation: {
        required: true,
        confirmed: false,
        threshold: input.threshold,
        reason: input.message,
      },
    });
  }

  private async enqueueWrite<T>(input: {
    baseId: string;
    tableId: string;
    task: () => Promise<T>;
  }): Promise<T> {
    return await this.writeQueue.enqueue({
      baseId: input.baseId,
      tableId: input.tableId,
      task: input.task,
    });
  }

  async createRecords(input: FeishuCreateRecordsInput): Promise<FeishuRecordWriteResult> {
    await this.ensureConnected(input.appId);
    const schema = await this.getSchemaForWrite(input);
    this.fieldMapper.validateRecords(schema, input.records);
    this.rememberRecentContext({
      appId: input.appId,
      baseId: input.baseId,
      tableId: input.tableId,
      fieldNames: collectRecordFieldNames(input.records) || schema.map((item) => item.fieldName),
      intent: 'create',
    });

    const confirmation = this.writePolicy.evaluate('create', input.records.length, input.confirmed);
    if (confirmation.required) {
      return this.buildConfirmationResult({
        action: 'create',
        baseId: input.baseId,
        tableId: input.tableId,
        message: confirmation.reason || '本次新增需要确认后再执行。',
        threshold: confirmation.threshold,
      });
    }

    const result = await this.enqueueWrite({
      baseId: input.baseId,
      tableId: input.tableId,
      task: async () => await this.adapter.createRecords(input),
    });
    return this.withAudit({
      ...result,
      confirmation,
    });
  }

  async upsertRecords(input: FeishuUpsertRecordsInput): Promise<FeishuRecordWriteResult> {
    await this.ensureConnected(input.appId);
    const schema = await this.getSchemaForWrite(input);
    this.fieldMapper.validateMatchFields(schema, input.matchByFields);
    this.fieldMapper.validateRecords(schema, input.records);
    this.rememberRecentContext({
      appId: input.appId,
      baseId: input.baseId,
      tableId: input.tableId,
      fieldNames: dedupeFieldNames([
        ...(collectRecordFieldNames(input.records) ?? []),
        ...input.matchByFields,
      ]) || schema.map((item) => item.fieldName),
      intent: 'upsert',
    });

    const confirmation = this.writePolicy.evaluate('upsert', input.records.length, input.confirmed);
    if (confirmation.required) {
      return this.buildConfirmationResult({
        action: 'upsert',
        baseId: input.baseId,
        tableId: input.tableId,
        message: confirmation.reason || '本次 upsert 需要确认后再执行。',
        threshold: confirmation.threshold,
      });
    }

    const result = await this.enqueueWrite({
      baseId: input.baseId,
      tableId: input.tableId,
      task: async () => await this.adapter.upsertRecords(input),
    });
    return this.withAudit({
      ...result,
      confirmation,
    });
  }

  async updateRecordsByFilter(input: FeishuUpdateRecordsByFilterInput): Promise<FeishuRecordWriteResult> {
    await this.ensureConnected(input.appId);
    const schema = await this.getSchemaForWrite(input);
    this.fieldMapper.validateFields(schema, input.fields);
    this.rememberRecentContext({
      appId: input.appId,
      baseId: input.baseId,
      tableId: input.tableId,
      fieldNames: dedupeFieldNames(Object.keys(input.fields)) || schema.map((item) => item.fieldName),
      intent: 'update_by_filter',
    });

    const preview = await this.queryRecords({
      appId: input.appId,
      baseId: input.baseId,
      tableId: input.tableId,
      filter: input.filter,
      pageSize: 200,
    });
    const matchedCount = preview.total ?? preview.records.length;
    const confirmation = this.writePolicy.evaluate('update_by_filter', matchedCount, input.confirmed);
    if (confirmation.required) {
      return this.buildConfirmationResult({
        action: 'update_by_filter',
        baseId: input.baseId,
        tableId: input.tableId,
        message: confirmation.reason || '本次按条件更新需要确认后再执行。',
        threshold: confirmation.threshold,
      });
    }

    const result = await this.enqueueWrite({
      baseId: input.baseId,
      tableId: input.tableId,
      task: async () => await this.adapter.updateRecordsByFilter(input),
    });
    const failureCount = Math.max(result.failureCount, Math.max(0, matchedCount - result.successCount));
    return this.withAudit({
      ...result,
      success: failureCount === 0,
      failureCount,
      matchedCount,
      confirmation,
    });
  }
}

export const feishuBaseService = new FeishuBaseService();
