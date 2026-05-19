import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeishuAuthService } from '../core/feishu/authService';
import { FeishuIntentOrchestrator } from '../core/feishu/orchestrator';
import { FeishuBaseService } from '../core/feishu/baseService';
import { FeishuResourceResolver } from '../core/feishu/resourceResolver';
import { FeishuSessionStore } from '../core/feishu/sessionStore';
import { FeishuToolMapper } from '../core/feishu/toolMapper';
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

class MockStageCAdapter implements FeishuCliAdapter {
  async checkNodeVersion(): Promise<FeishuCliRawResult> {
    return { command: 'node --version', stdout: 'v22.0.0', stderr: '', code: 0 };
  }

  async checkCliVersion(): Promise<FeishuCliRawResult> {
    return { command: 'npx --version', stdout: '0.5.1', stderr: '', code: 0 };
  }

  async startLogin(_input: FeishuLoginStartInput, onOutput?: (line: string) => void): Promise<FeishuCliLoginHandle> {
    onOutput?.('Please continue in browser: https://open.feishu.cn/mock-auth');
    return {
      id: 'login-1',
      command: 'login',
      completion: Promise.resolve({
        command: 'login',
        stdout: 'Login successful\nname: Tom\nemail: tom@example.com',
        stderr: '',
        code: 0,
      }),
    };
  }

  async logout(): Promise<FeishuCliRawResult> {
    return { command: 'logout', stdout: 'ok', stderr: '', code: 0 };
  }

  async listBases(_input?: FeishuListBasesInput): Promise<FeishuCliRawResult> {
    return {
      command: 'drive.v1.file.list',
      stdout: JSON.stringify({
        data: {
          files: [
            { token: 'app_sales', name: '销售Base', type: 'bitable' },
            { token: 'app_ops', name: '运营Base', type: 'bitable' },
          ],
          has_more: false,
        },
      }),
      stderr: '',
      code: 0,
    };
  }

  async listTables(input: FeishuListTablesInput): Promise<FeishuCliRawResult> {
    const items = input.baseId === 'app_sales'
      ? [
          { table_id: 'tbl_customer_a', name: '客户表' },
          { table_id: 'tbl_customer_b', name: '客户表' },
          { table_id: 'tbl_order', name: '订单表' },
        ]
      : [{ table_id: 'tbl_misc', name: '杂项表' }];

    return {
      command: 'bitable.v1.appTable.list',
      stdout: JSON.stringify({
        data: {
          items,
          has_more: false,
        },
      }),
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
            { field_id: 'fld_level', field_name: '等级', type: 'singleSelect', is_writable: true },
          ],
          has_more: false,
        },
      }),
      stderr: '',
      code: 0,
    };
  }

  async queryRecords(input: FeishuQueryRecordsInput): Promise<FeishuCliRawResult> {
    return {
      command: 'bitable.v1.appTableRecord.search',
      stdout: JSON.stringify({
        data: {
          items: [
            { record_id: 'rec_1', fields: { 客户名称: 'Tom', 来源表: input.tableId } },
            { record_id: 'rec_2', fields: { 客户名称: 'Jerry', 来源表: input.tableId } },
          ],
          has_more: false,
          total: 2,
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

function seedConnectedStore(store: FeishuSessionStore, appId = 'cli_stage_c'): void {
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

function createOrchestrator(store = new FeishuSessionStore()): FeishuIntentOrchestrator {
  const adapter = new MockStageCAdapter();
  const authService = new FeishuAuthService(adapter, store);
  const baseService = new FeishuBaseService(adapter, authService, store);
  const resolver = new FeishuResourceResolver(baseService, store);
  const mapper = new FeishuToolMapper();
  return new FeishuIntentOrchestrator(authService, baseService, store, mapper, resolver);
}

describe('Feishu stage C integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    registerBuiltinTools();
  });

  it('handles natural language request for listing bases', async () => {
    const store = new FeishuSessionStore();
    seedConnectedStore(store);
    const orchestrator = createOrchestrator(store);

    const result = await orchestrator.handleRequest({
      appId: 'cli_stage_c',
      query: '列出我的 Base',
    });

    expect(result.intent.kind).toBe('list_bases');
    expect(result.needClarification).toBe(false);
    expect((result.result as { items: Array<{ id: string }> }).items[0]?.id).toBe('app_sales');
  });

  it('uses recent context to read table schema', async () => {
    const store = new FeishuSessionStore();
    seedConnectedStore(store);
    store.setRecentContext('cli_stage_c', {
      appId: 'cli_stage_c',
      baseId: 'app_sales',
      baseName: '销售Base',
      updatedAt: Date.now(),
    });
    const orchestrator = createOrchestrator(store);

    const result = await orchestrator.handleRequest({
      appId: 'cli_stage_c',
      query: '查看订单表字段',
    });

    expect(result.intent.kind).toBe('get_table_schema');
    expect(result.needClarification).toBe(false);
    expect((result.result as { items: Array<{ fieldName: string }> }).items[0]?.fieldName).toBe('客户名称');
    expect(result.resolvedContext.table?.id).toBe('tbl_order');
  });

  it('asks for missing table when query records lacks target table', async () => {
    const store = new FeishuSessionStore();
    seedConnectedStore(store);
    store.setRecentContext('cli_stage_c', {
      appId: 'cli_stage_c',
      baseId: 'app_sales',
      baseName: '销售Base',
      updatedAt: Date.now(),
    });
    const orchestrator = createOrchestrator(store);

    const result = await orchestrator.handleRequest({
      appId: 'cli_stage_c',
      query: '查看最近 10 条记录',
    });

    expect(result.intent.kind).toBe('query_records');
    expect(result.needClarification).toBe(true);
    expect(result.clarificationQuestion).toContain('哪张表');
  });

  it('returns candidates when table name is ambiguous', async () => {
    const store = new FeishuSessionStore();
    seedConnectedStore(store);
    store.setRecentContext('cli_stage_c', {
      appId: 'cli_stage_c',
      baseId: 'app_sales',
      baseName: '销售Base',
      updatedAt: Date.now(),
    });
    const orchestrator = createOrchestrator(store);

    const result = await orchestrator.handleRequest({
      appId: 'cli_stage_c',
      query: '查看客户表字段',
    });

    expect(result.needClarification).toBe(true);
    expect(result.resolvedContext.candidates).toHaveLength(2);
    expect(result.clarificationQuestion).toContain('多个同名或相近的表');
  });

  it('registers stage C natural language tool and returns structured json', async () => {
    expect(toolRegistry.get('feishu_handle_request')).toBeDefined();

    vi.spyOn(feishuFacade, 'handleRequest').mockResolvedValue({
      intent: {
        kind: 'list_bases',
        confidence: 'high',
        query: '列出我的 Base',
        slots: [],
        missingSlots: [],
      },
      resolvedContext: {},
      needClarification: false,
      executionPlan: {
        intent: 'list_bases',
        steps: [],
      },
      result: {
        items: [{ id: 'app_sales', name: '销售Base' }],
        hasMore: false,
        pageToken: null,
      },
      message: '已找到 1 个 Base。',
    });

    const toolResult = await toolRegistry.get('feishu_handle_request')!.execute({
      query: '列出我的 Base',
    });

    const parsed = JSON.parse(toolResult as string) as {
      intent: { kind: string };
      result: { items: Array<{ id: string }> };
    };
    expect(parsed.intent.kind).toBe('list_bases');
    expect(parsed.result.items[0]?.id).toBe('app_sales');
  });
});
