import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeishuAuthService } from '../core/feishu/authService';
import { FeishuBaseService } from '../core/feishu/baseService';
import { FEISHU_ERROR_CODES } from '../core/feishu/errorCodes';
import { FeishuSessionStore } from '../core/feishu/sessionStore';
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
import { registerBuiltinTools } from '../core/tools/builtins';
import { feishuFacade } from '../core/feishu/facade';
import { toolRegistry } from '../core/tools/registry';

class MockStageBAdapter implements FeishuCliAdapter {
  listBasesCalls = 0;
  listTablesCalls = 0;
  schemaCalls = 0;
  recordCalls = 0;

  async checkNodeVersion(): Promise<FeishuCliRawResult> {
    return { command: 'node --version', stdout: 'v22.0.0', stderr: '', code: 0 };
  }

  async checkCliVersion(): Promise<FeishuCliRawResult> {
    return { command: 'npx --version', stdout: '0.5.1', stderr: '', code: 0 };
  }

  async startLogin(_input: FeishuLoginStartInput): Promise<FeishuCliLoginHandle> {
    return {
      id: 'login-1',
      command: 'login',
      completion: Promise.resolve({ command: 'login', stdout: '', stderr: '', code: 0 }),
    };
  }

  async logout(): Promise<FeishuCliRawResult> {
    return { command: 'logout', stdout: 'ok', stderr: '', code: 0 };
  }

  async listBases(_input?: FeishuListBasesInput): Promise<FeishuCliRawResult> {
    this.listBasesCalls += 1;
    return {
      command: 'drive.v1.file.list',
      stdout: JSON.stringify({
        data: {
          files: [
            { token: 'app_alpha', name: 'Alpha Base', type: 'bitable', url: 'https://feishu.cn/base/app_alpha' },
            { token: 'folder_root', name: 'Shared Folder', type: 'folder' },
          ],
          has_more: false,
        },
      }),
      stderr: '',
      code: 0,
    };
  }

  async listTables(input: FeishuListTablesInput): Promise<FeishuCliRawResult> {
    this.listTablesCalls += 1;
    return {
      command: 'bitable.v1.appTable.list',
      stdout: JSON.stringify({
        data: {
          items: [
            { table_id: 'tbl_orders', name: `${input.baseId}-Orders` },
          ],
          has_more: false,
        },
      }),
      stderr: '',
      code: 0,
    };
  }

  async getTableSchema(_input: FeishuGetTableSchemaInput): Promise<FeishuCliRawResult> {
    this.schemaCalls += 1;
    return {
      command: 'bitable.v1.appTableField.list',
      stdout: JSON.stringify({
        data: {
          items: [
            { field_id: 'fld_name', field_name: 'Name', type: 'text', is_writable: true },
            {
              field_id: 'fld_status',
              field_name: 'Status',
              type: 'singleSelect',
              property: { options: [{ name: 'Open' }, { name: 'Closed' }] },
            },
          ],
          has_more: false,
        },
      }),
      stderr: '',
      code: 0,
    };
  }

  async queryRecords(_input: FeishuQueryRecordsInput): Promise<FeishuCliRawResult> {
    this.recordCalls += 1;
    return {
      command: 'bitable.v1.appTableRecord.search',
      stdout: JSON.stringify({
        data: {
          items: [
            { record_id: 'rec_1', fields: { Name: 'Tom', Score: 95 } },
          ],
          page_token: 'next-token',
          has_more: true,
          total: 1,
        },
      }),
      stderr: '',
      code: 0,
    };
  }

  async createRecords(_input: FeishuCreateRecordsInput): Promise<FeishuRecordWriteResult> {
    throw new Error('not implemented');
  }

  async upsertRecords(_input: FeishuUpsertRecordsInput): Promise<FeishuRecordWriteResult> {
    throw new Error('not implemented');
  }

  async updateRecordsByFilter(_input: FeishuUpdateRecordsByFilterInput): Promise<FeishuRecordWriteResult> {
    throw new Error('not implemented');
  }
}

function seedConnectedStore(store: FeishuSessionStore, appId = 'cli_stage_b'): void {
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
    errorCode: FEISHU_ERROR_CODES.AUTH_REQUIRED,
    appId,
    domain: 'https://open.feishu.cn',
    account: { name: 'Tom' },
    tenant: null,
    authUrl: undefined,
    expiresAt: null,
    lastUpdatedAt: Date.now(),
  });
}

describe('Feishu stage B integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    registerBuiltinTools();
  });

  it('normalizes stage B read results and reuses cache', async () => {
    const adapter = new MockStageBAdapter();
    const store = new FeishuSessionStore();
    seedConnectedStore(store);
    const authService = new FeishuAuthService(adapter, store);
    const service = new FeishuBaseService(adapter, authService, store);

    const bases = await service.listBases({ appId: 'cli_stage_b' });
    const cachedBases = await service.listBases({ appId: 'cli_stage_b' });
    const tables = await service.listTables({ appId: 'cli_stage_b', baseId: 'app_alpha' });
    const schema = await service.getTableSchema({ appId: 'cli_stage_b', baseId: 'app_alpha', tableId: 'tbl_orders' });
    const records = await service.queryRecords({ appId: 'cli_stage_b', baseId: 'app_alpha', tableId: 'tbl_orders' });

    expect(bases.items).toEqual([{ id: 'app_alpha', name: 'Alpha Base', url: 'https://feishu.cn/base/app_alpha' }]);
    expect(cachedBases.items).toEqual(bases.items);
    expect(adapter.listBasesCalls).toBe(1);
    expect(tables.items[0]).toEqual({ id: 'tbl_orders', name: 'app_alpha-Orders', baseId: 'app_alpha' });
    expect(schema.items[1]?.options).toEqual(['Open', 'Closed']);
    expect(records.records[0]).toEqual({ recordId: 'rec_1', Name: 'Tom', Score: 95 });
    expect(records.pageToken).toBe('next-token');
    expect(records.hasMore).toBe(true);
  });

  it('registers stage B feishu tools and returns structured json', async () => {
    expect(toolRegistry.get('feishu_list_bases')).toBeDefined();
    expect(toolRegistry.get('feishu_list_tables')).toBeDefined();
    expect(toolRegistry.get('feishu_get_table_schema')).toBeDefined();
    expect(toolRegistry.get('feishu_query_records')).toBeDefined();

    vi.spyOn(feishuFacade, 'listBases').mockResolvedValue({
      items: [{ id: 'app_alpha', name: 'Alpha Base', url: 'https://feishu.cn/base/app_alpha' }],
      pageToken: null,
      hasMore: false,
    });
    vi.spyOn(feishuFacade, 'queryRecords').mockResolvedValue({
      records: [{ recordId: 'rec_1', Name: 'Tom' }],
      pageToken: null,
      hasMore: false,
      total: 1,
    });

    const basesResult = await toolRegistry.get('feishu_list_bases')!.execute({});
    const queryResult = await toolRegistry.get('feishu_query_records')!.execute({
      baseId: 'app_alpha',
      tableId: 'tbl_orders',
      sort: [{ fieldName: 'Name', desc: true }],
    });

    const parsedBases = JSON.parse(basesResult as string) as { items: Array<{ id: string }> };
    const parsedRecords = JSON.parse(queryResult as string) as { records: Array<{ recordId: string }> };

    expect(parsedBases.items[0]?.id).toBe('app_alpha');
    expect(parsedRecords.records[0]?.recordId).toBe('rec_1');
  });
});
