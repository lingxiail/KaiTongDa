import type { FeishuCliAdapter, FeishuCliRawResult } from './cliAdapter';
import { feishuCliAdapter } from './cliAdapter';
import { FeishuAuthService, feishuAuthService } from './authService';
import { buildFeishuWriteAuditSummary } from './audit';
import { FeishuFieldMapper, feishuFieldMapper } from './fieldMapper';
import { FeishuResultNormalizer, feishuResultNormalizer } from './resultNormalizer';
import { FeishuSessionStore, feishuSessionStore } from './sessionStore';
import { FeishuWritePolicy, feishuWritePolicy } from './writePolicy';
import type {
  FeishuCreateRecordsInput,
  FeishuGetTableSchemaInput,
  FeishuListBasesInput,
  FeishuListTablesInput,
  FeishuQueryRecordsInput,
  FeishuRecordQueryResult,
  FeishuRecordWriteResult,
  FeishuUpdateRecordsByFilterInput,
  FeishuUpsertRecordsInput,
} from './types';

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
    private readonly fieldMapper: FeishuFieldMapper = feishuFieldMapper,
    private readonly writePolicy: FeishuWritePolicy = feishuWritePolicy,
    private readonly resultNormalizer: FeishuResultNormalizer = feishuResultNormalizer,
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
    const result = this.resultNormalizer.toPagedResult(
      this.resultNormalizer.parseJsonPayload(raw.stdout),
      (item) => this.resultNormalizer.normalizeBase(item),
    );
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
    const result = this.resultNormalizer.toPagedResult(
      this.resultNormalizer.parseJsonPayload(raw.stdout),
      (item) => this.resultNormalizer.normalizeTable(input.baseId, item),
    );
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
    const result = this.resultNormalizer.toPagedResult(
      this.resultNormalizer.parseJsonPayload(raw.stdout),
      (item) => this.resultNormalizer.normalizeField(item),
    );
    if (!input.pageToken) {
      this.store.setCachedSchema(input.appId, input.baseId, input.tableId, result);
    }
    return result;
  }

  async queryRecords(input: FeishuQueryRecordsInput): Promise<FeishuRecordQueryResult> {
    await this.ensureConnected(input.appId);
    const raw = await this.adapter.queryRecords(input);
    ensureRawSuccess(raw);
    return this.resultNormalizer.normalizeRecordQueryResult(
      this.resultNormalizer.parseJsonPayload(raw.stdout),
    );
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

  async createRecords(input: FeishuCreateRecordsInput): Promise<FeishuRecordWriteResult> {
    await this.ensureConnected(input.appId);
    const schema = await this.getSchemaForWrite(input);
    this.fieldMapper.validateRecords(schema, input.records);

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

    const result = await this.adapter.createRecords(input);
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

    const result = await this.adapter.upsertRecords(input);
    return this.withAudit({
      ...result,
      confirmation,
    });
  }

  async updateRecordsByFilter(input: FeishuUpdateRecordsByFilterInput): Promise<FeishuRecordWriteResult> {
    await this.ensureConnected(input.appId);
    const schema = await this.getSchemaForWrite(input);
    this.fieldMapper.validateFields(schema, input.fields);

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

    const result = await this.adapter.updateRecordsByFilter(input);
    return this.withAudit({
      ...result,
      confirmation,
    });
  }
}

export const feishuBaseService = new FeishuBaseService();
