import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeishuAuthService } from '../core/feishu/authService';
import { FeishuBaseService } from '../core/feishu/baseService';
import { FeishuFieldMapper } from '../core/feishu/fieldMapper';
import { FeishuSessionStore } from '../core/feishu/sessionStore';
import { FeishuWritePolicy } from '../core/feishu/writePolicy';
import { FeishuWriteQueue } from '../core/feishu/writeQueue';
import type { FeishuCommandRawResult, FeishuConnectorAdapter, FeishuConnectorLoginHandle } from '../core/feishu/connectorAdapter';
import type {
  FeishuCreateRecordsInput,
  FeishuGetTableSchemaInput,
  FeishuListBasesInput,
  FeishuListTablesInput,
  FeishuLoginStartInput,
  FeishuQueryRecordsInput,
  FeishuRecordWriteResult,
  FeishuUpdateRecordsByFilterInput,
  FeishuUpsertRecordsInput,
} from '../core/feishu/types';

class MockStageDAdapter implements FeishuConnectorAdapter {
  async checkNodeVersion(): Promise<FeishuCommandRawResult> {
    return { command: 'node --version', stdout: 'v22.0.0', stderr: '', code: 0 };
  }

  async checkNpxVersion(): Promise<FeishuCommandRawResult> {
    return { command: 'npx --version', stdout: '10.0.0', stderr: '', code: 0 };
  }

  async checkCliVersion(): Promise<FeishuCommandRawResult> {
    return { command: 'lark-cli --version', stdout: '1.0.23', stderr: '', code: 0 };
  }

  async installCli(): Promise<FeishuCommandRawResult> {
    return { command: 'install', stdout: 'installed', stderr: '', code: 0 };
  }

  async initializeConfig(): Promise<FeishuCommandRawResult> {
    return { command: 'config', stdout: 'ok', stderr: '', code: 0 };
  }

  async startLogin(_input: FeishuLoginStartInput): Promise<FeishuConnectorLoginHandle> {
    return {
      id: 'login-1',
      command: 'login',
      completion: Promise.resolve({
        command: 'login',
        stdout: 'Login successful\nname: Tom',
        stderr: '',
        code: 0,
      }),
    };
  }

  async getAuthStatus(): Promise<FeishuCommandRawResult> {
    return {
      command: 'auth status',
      stdout: 'Authorized account: Tom (tom@example.com)',
      stderr: '',
      code: 0,
    };
  }

  async logout(): Promise<FeishuCommandRawResult> {
    return { command: 'logout', stdout: 'ok', stderr: '', code: 0 };
  }

  async listBases(_input?: FeishuListBasesInput): Promise<FeishuCommandRawResult> {
    return {
      command: 'drive.v1.file.list',
      stdout: JSON.stringify({ data: { items: [] } }),
      stderr: '',
      code: 0,
    };
  }

  async listTables(_input: FeishuListTablesInput): Promise<FeishuCommandRawResult> {
    return {
      command: 'bitable.v1.appTable.list',
      stdout: JSON.stringify({ data: { items: [] } }),
      stderr: '',
      code: 0,
    };
  }

  async getTableSchema(_input: FeishuGetTableSchemaInput): Promise<FeishuCommandRawResult> {
    return {
      command: 'bitable.v1.appTableField.list',
      stdout: JSON.stringify({
        data: {
          items: [
            { field_id: 'fld_name', field_name: '客户名称', type: 'text', is_writable: true },
            { field_id: 'fld_amount', field_name: '金额', type: 'number', is_writable: true },
            { field_id: 'fld_enabled', field_name: '已启用', type: 'checkbox', is_writable: true },
          ],
          has_more: false,
        },
      }),
      stderr: '',
      code: 0,
    };
  }

  async queryRecords(input: FeishuQueryRecordsInput): Promise<FeishuCommandRawResult> {
    const matchedItems = input.filter && 'status' in input.filter
      ? Array.from({ length: 2 }).map((_, index) => ({
          record_id: `rec_${index + 1}`,
          fields: { 客户名称: `客户${index + 1}`, status: 'pending' },
        }))
      : [];

    return {
      command: 'bitable.v1.appTableRecord.search',
      stdout: JSON.stringify({
        data: {
          items: matchedItems,
          total: matchedItems.length,
          has_more: false,
        },
      }),
      stderr: '',
      code: 0,
    };
  }

  async createRecords(input: FeishuCreateRecordsInput): Promise<FeishuRecordWriteResult> {
    return {
      success: true,
      action: 'create',
      baseId: input.baseId,
      tableId: input.tableId,
      successCount: input.records.length,
      failureCount: 0,
      createdCount: input.records.length,
      failures: [],
      message: `已成功新增 ${input.records.length} 条记录。`,
    };
  }

  async upsertRecords(input: FeishuUpsertRecordsInput): Promise<FeishuRecordWriteResult> {
    return {
      success: true,
      action: 'upsert',
      baseId: input.baseId,
      tableId: input.tableId,
      successCount: input.records.length,
      failureCount: 0,
      createdCount: 1,
      updatedCount: input.records.length - 1,
      matchedCount: input.records.length - 1,
      failures: [],
      message: 'upsert 完成。',
    };
  }

  async updateRecordsByFilter(input: FeishuUpdateRecordsByFilterInput): Promise<FeishuRecordWriteResult> {
    return {
      success: true,
      action: 'update_by_filter',
      baseId: input.baseId,
      tableId: input.tableId,
      successCount: 2,
      failureCount: 0,
      updatedCount: 2,
      matchedCount: 2,
      failures: [],
      message: '已按条件更新 2 条记录。',
    };
  }
}

function seedConnectedStore(store: FeishuSessionStore, appId = 'cli_stage_d'): void {
  store.setRuntimeConfig({
    appId,
    appSecret: 'secret',
    domain: 'https://open.feishu.cn',
  });
  store.updateConnectionStatus(appId, {
    success: true,
    connected: true,
    state: 'connected',
    phase: 'connected',
    message: '已连接',
    appId,
    domain: 'https://open.feishu.cn',
    account: { name: 'Tom' },
    tenant: null,
    authUrl: undefined,
    expiresAt: null,
    lastUpdatedAt: Date.now(),
  });
}

function createBaseService(
  writePolicy = new FeishuWritePolicy(),
  adapter: FeishuConnectorAdapter = new MockStageDAdapter(),
  writeQueue = new FeishuWriteQueue(),
): FeishuBaseService {
  const store = new FeishuSessionStore();
  seedConnectedStore(store);
  const authService = new FeishuAuthService(adapter, store);
  return new FeishuBaseService(adapter, authService, store, new FeishuFieldMapper(), writePolicy, undefined, writeQueue);
}

describe('Feishu write safety pipeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates records and returns audit summary', async () => {
    const service = createBaseService();
    const result = await service.createRecords({
      appId: 'cli_stage_d',
      baseId: 'app_sales',
      tableId: 'tbl_customer',
      records: [{ 客户名称: 'Tom', 金额: 99, 已启用: true }],
    });

    expect(result.success).toBe(true);
    expect(result.createdCount).toBe(1);
    expect(result.audit?.action).toBe('create');
    expect(result.audit?.tableId).toBe('tbl_customer');
  });

  it('rejects unknown write fields before calling adapter', async () => {
    const service = createBaseService();

    await expect(service.createRecords({
      appId: 'cli_stage_d',
      baseId: 'app_sales',
      tableId: 'tbl_customer',
      records: [{ 不存在字段: 'x' }],
    })).rejects.toThrow('feishu_field_mismatch');
  });

  it('upserts records with explicit match fields', async () => {
    const service = createBaseService();
    const result = await service.upsertRecords({
      appId: 'cli_stage_d',
      baseId: 'app_sales',
      tableId: 'tbl_customer',
      matchByFields: ['客户名称'],
      records: [
        { 客户名称: 'Tom', 金额: 99 },
        { 客户名称: 'Jerry', 金额: 88 },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.createdCount).toBe(1);
    expect(result.updatedCount).toBe(1);
    expect(result.audit?.action).toBe('upsert');
  });

  it('requires confirmation before large filter update', async () => {
    const service = createBaseService(new FeishuWritePolicy({
      createConfirmThreshold: 20,
      upsertConfirmThreshold: 20,
      updateMatchConfirmThreshold: 1,
    }));

    const result = await service.updateRecordsByFilter({
      appId: 'cli_stage_d',
      baseId: 'app_sales',
      tableId: 'tbl_customer',
      filter: { status: 'pending' },
      fields: { 已启用: true },
    });

    expect(result.success).toBe(false);
    expect(result.confirmation?.required).toBe(true);
    expect(result.message).toContain('超过确认阈值');
  });

  it('requires confirmation before large create and does not call adapter', async () => {
    class CountingAdapter extends MockStageDAdapter {
      createCalls = 0;

      override async createRecords(input: FeishuCreateRecordsInput): Promise<FeishuRecordWriteResult> {
        this.createCalls += 1;
        return await super.createRecords(input);
      }
    }

    const adapter = new CountingAdapter();
    const service = createBaseService(new FeishuWritePolicy({
      createConfirmThreshold: 1,
      upsertConfirmThreshold: 20,
      updateMatchConfirmThreshold: 10,
    }), adapter);

    const result = await service.createRecords({
      appId: 'cli_stage_d',
      baseId: 'app_sales',
      tableId: 'tbl_customer',
      records: [
        { 客户名称: 'Tom', 金额: 99 },
        { 客户名称: 'Jerry', 金额: 88 },
      ],
    });

    expect(adapter.createCalls).toBe(0);
    expect(result.success).toBe(false);
    expect(result.confirmation).toMatchObject({
      required: true,
      confirmed: false,
      threshold: 1,
    });
    expect(result.audit).toMatchObject({
      action: 'create',
      baseId: 'app_sales',
      tableId: 'tbl_customer',
      successCount: 0,
      failureCount: 0,
    });
  });

  it('allows confirmed large upsert and records audit confirmation state', async () => {
    class CountingAdapter extends MockStageDAdapter {
      upsertCalls = 0;

      override async upsertRecords(input: FeishuUpsertRecordsInput): Promise<FeishuRecordWriteResult> {
        this.upsertCalls += 1;
        return await super.upsertRecords(input);
      }
    }

    const adapter = new CountingAdapter();
    const service = createBaseService(new FeishuWritePolicy({
      createConfirmThreshold: 20,
      upsertConfirmThreshold: 1,
      updateMatchConfirmThreshold: 10,
    }), adapter);

    const result = await service.upsertRecords({
      appId: 'cli_stage_d',
      baseId: 'app_sales',
      tableId: 'tbl_customer',
      matchByFields: ['客户名称'],
      records: [
        { 客户名称: 'Tom', 金额: 99 },
        { 客户名称: 'Jerry', 金额: 88 },
      ],
      confirmed: true,
    });

    expect(adapter.upsertCalls).toBe(1);
    expect(result.success).toBe(true);
    expect(result.confirmation).toMatchObject({
      required: false,
      confirmed: true,
      threshold: 1,
    });
    expect(result.audit).toMatchObject({
      action: 'upsert',
      successCount: 2,
      failureCount: 0,
    });
  });

  it('serializes same-table writes through the write queue', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;

    class QueueAwareAdapter extends MockStageDAdapter {
      override async createRecords(input: FeishuCreateRecordsInput): Promise<FeishuRecordWriteResult> {
        if (input.records[0]?.客户名称 === 'Tom') {
          events.push('first:start');
          await new Promise<void>((resolve) => {
            releaseFirst = () => {
              events.push('first:end');
              resolve();
            };
          });
        } else {
          events.push('second:start');
        }

        return await super.createRecords(input);
      }
    }

    const service = createBaseService(new FeishuWritePolicy(), new QueueAwareAdapter(), new FeishuWriteQueue());
    const first = service.createRecords({
      appId: 'cli_stage_d',
      baseId: 'app_sales',
      tableId: 'tbl_customer',
      records: [{ 客户名称: 'Tom', 金额: 99 }],
    });
    const second = service.createRecords({
      appId: 'cli_stage_d',
      baseId: 'app_sales',
      tableId: 'tbl_customer',
      records: [{ 客户名称: 'Jerry', 金额: 88 }],
    });

    await vi.waitFor(() => {
      expect(events).toEqual(['first:start']);
    });

    releaseFirst();

    await first;
    await second;
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });
});
