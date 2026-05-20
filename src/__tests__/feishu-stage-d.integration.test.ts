import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeishuAuthService } from '../core/feishu/authService';
import { FeishuBaseService } from '../core/feishu/baseService';
import { FeishuFieldMapper } from '../core/feishu/fieldMapper';
import { FeishuSessionStore } from '../core/feishu/sessionStore';
import { FeishuWritePolicy } from '../core/feishu/writePolicy';
import type { FeishuCliAdapter, FeishuCliLoginHandle, FeishuCliRawResult } from '../core/feishu/cliAdapter';
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

class MockStageDAdapter implements FeishuCliAdapter {
  async checkNodeVersion(): Promise<FeishuCliRawResult> {
    return { command: 'node --version', stdout: 'v22.0.0', stderr: '', code: 0 };
  }

  async checkNpxVersion(): Promise<FeishuCliRawResult> {
    return { command: 'npx --version', stdout: '10.0.0', stderr: '', code: 0 };
  }

  async checkCliVersion(): Promise<FeishuCliRawResult> {
    return { command: 'lark-cli --version', stdout: '1.0.23', stderr: '', code: 0 };
  }

  async installCli(): Promise<FeishuCliRawResult> {
    return { command: 'install', stdout: 'installed', stderr: '', code: 0 };
  }

  async initializeConfig(): Promise<FeishuCliRawResult> {
    return { command: 'config', stdout: 'ok', stderr: '', code: 0 };
  }

  async startLogin(_input: FeishuLoginStartInput): Promise<FeishuCliLoginHandle> {
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

  async getAuthStatus(): Promise<FeishuCliRawResult> {
    return {
      command: 'auth status',
      stdout: 'Authorized account: Tom (tom@example.com)',
      stderr: '',
      code: 0,
    };
  }

  async logout(): Promise<FeishuCliRawResult> {
    return { command: 'logout', stdout: 'ok', stderr: '', code: 0 };
  }

  async listBases(_input?: FeishuListBasesInput): Promise<FeishuCliRawResult> {
    return {
      command: 'drive.v1.file.list',
      stdout: JSON.stringify({ data: { items: [] } }),
      stderr: '',
      code: 0,
    };
  }

  async listTables(_input: FeishuListTablesInput): Promise<FeishuCliRawResult> {
    return {
      command: 'bitable.v1.appTable.list',
      stdout: JSON.stringify({ data: { items: [] } }),
      stderr: '',
      code: 0,
    };
  }

  async getTableSchema(_input: FeishuGetTableSchemaInput): Promise<FeishuCliRawResult> {
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

  async queryRecords(input: FeishuQueryRecordsInput): Promise<FeishuCliRawResult> {
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

function createBaseService(writePolicy = new FeishuWritePolicy()): FeishuBaseService {
  const store = new FeishuSessionStore();
  seedConnectedStore(store);
  const adapter = new MockStageDAdapter();
  const authService = new FeishuAuthService(adapter, store);
  return new FeishuBaseService(adapter, authService, store, new FeishuFieldMapper(), writePolicy);
}

describe('Feishu stage D integration', () => {
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
});
