import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeishuAuthService } from '../core/feishu/authService';
import { FeishuIntentOrchestrator } from '../core/feishu/orchestrator';
import { FeishuBaseService } from '../core/feishu/baseService';
import { FeishuResourceResolver } from '../core/feishu/resourceResolver';
import { FeishuSessionStore } from '../core/feishu/sessionStore';
import { FeishuToolMapper } from '../core/feishu/toolMapper';
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
import { registerBuiltinTools } from '../core/tools/builtins';
import { feishuFacade } from '../core/feishu/facade';
import { toolRegistry } from '../core/tools/registry';

class MockStageCAdapter implements FeishuConnectorAdapter {
  listBasesCalls = 0;
  lastListBasesInput?: FeishuListBasesInput;

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

  async startLogin(_input: FeishuLoginStartInput, onOutput?: (line: string) => void): Promise<FeishuConnectorLoginHandle> {
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

  async listBases(input?: FeishuListBasesInput): Promise<FeishuCommandRawResult> {
    this.listBasesCalls += 1;
    this.lastListBasesInput = input;
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

  async listTables(input: FeishuListTablesInput): Promise<FeishuCommandRawResult> {
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

  async getTableSchema(_input: FeishuGetTableSchemaInput): Promise<FeishuCommandRawResult> {
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

  async queryRecords(input: FeishuQueryRecordsInput): Promise<FeishuCommandRawResult> {
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

class DirectBaseTokenAdapter extends MockStageCAdapter {
  async listBases(_input?: FeishuListBasesInput): Promise<FeishuCommandRawResult> {
    this.listBasesCalls += 1;
    return {
      command: 'drive.v1.file.list',
      stdout: JSON.stringify({ code: 1254030, msg: 'Global drive list should not be required' }),
      stderr: '',
      code: 0,
    };
  }

  async listTables(input: FeishuListTablesInput): Promise<FeishuCommandRawResult> {
    return {
      command: 'bitable.v1.appTable.list',
      stdout: JSON.stringify({
        data: {
          items: [
            { table_id: 'tbl_direct', name: `${input.baseId}-Direct` },
          ],
          has_more: false,
        },
      }),
      stderr: '',
      code: 0,
    };
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

function createOrchestrator(
  store = new FeishuSessionStore(),
  adapter: FeishuConnectorAdapter = new MockStageCAdapter(),
): FeishuIntentOrchestrator {
  const authService = new FeishuAuthService(adapter, store);
  const baseService = new FeishuBaseService(adapter, authService, store);
  const resolver = new FeishuResourceResolver(baseService, store);
  const mapper = new FeishuToolMapper();
  return new FeishuIntentOrchestrator(authService, baseService, store, mapper, resolver);
}

describe('Feishu natural language orchestration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    registerBuiltinTools();
  });

  it('plans base listing requests without executing remote reads', async () => {
    const store = new FeishuSessionStore();
    seedConnectedStore(store);
    const adapter = new MockStageCAdapter();
    const orchestrator = createOrchestrator(store, adapter);

    const result = await orchestrator.handleRequest({
      appId: 'cli_stage_c',
      query: '列出我的 Base',
    });

    expect(result.intent.kind).toBe('list_bases');
    expect(result.needClarification).toBe(false);
    expect(result.result).toBeUndefined();
    expect(result.executionPlan.steps[1]).toMatchObject({
      toolName: 'feishu_list_bases',
      status: 'pending',
    });
    expect(adapter.listBasesCalls).toBe(0);
  });

  it('keeps base listing in planning mode instead of touching stale cache or remote data', async () => {
    const store = new FeishuSessionStore();
    seedConnectedStore(store);
    store.setCachedBases('cli_stage_c', {
      items: [],
      pageToken: null,
      hasMore: false,
    });
    const adapter = new MockStageCAdapter();
    const orchestrator = createOrchestrator(store, adapter);

    const result = await orchestrator.handleRequest({
      appId: 'cli_stage_c',
      query: '列出我可读的多维表格',
    });

    expect(result.intent.kind).toBe('list_bases');
    expect(adapter.listBasesCalls).toBe(0);
    expect(result.executionPlan.steps[1]).toMatchObject({
      toolName: 'feishu_list_bases',
      status: 'pending',
    });
    expect(result.message).toContain('请继续调用 feishu_list_bases');
  });

  it('lists tables from a direct Feishu base token without requiring global base listing', async () => {
    const store = new FeishuSessionStore();
    seedConnectedStore(store);
    const adapter = new DirectBaseTokenAdapter();
    const orchestrator = createOrchestrator(store, adapter);

    const result = await orchestrator.handleRequest({
      appId: 'cli_stage_c',
      query: '列出LmXDbh8aCa1muPszAlgcCiXcnkh下的数据表',
    });

    expect(result.intent.kind).toBe('list_tables');
    expect(result.needClarification).toBe(false);
    expect(result.resolvedContext.base?.id).toBe('LmXDbh8aCa1muPszAlgcCiXcnkh');
    expect(result.result).toBeUndefined();
    expect(result.executionPlan.steps[1]).toMatchObject({
      toolName: 'feishu_list_tables',
      input: {
        appId: 'cli_stage_c',
        baseId: 'LmXDbh8aCa1muPszAlgcCiXcnkh',
      },
    });
    expect(adapter.listBasesCalls).toBe(0);
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
    expect(result.resolvedContext.table?.id).toBe('tbl_order');
    expect(result.resolvedContext.fieldSchemas?.[0]?.fieldName).toBe('客户名称');
    expect(result.result).toBeUndefined();
    expect(result.executionPlan.steps[1]).toMatchObject({
      toolName: 'feishu_get_table_schema',
      input: {
        appId: 'cli_stage_c',
        baseId: 'app_sales',
        tableId: 'tbl_order',
      },
    });
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

  it('returns a structured write plan when action and recent table are both clear', async () => {
    const store = new FeishuSessionStore();
    seedConnectedStore(store);
    store.setRecentContext('cli_stage_c', {
      appId: 'cli_stage_c',
      baseId: 'app_sales',
      baseName: '销售Base',
      tableId: 'tbl_order',
      tableName: '订单表',
      updatedAt: Date.now(),
    });
    const orchestrator = createOrchestrator(store);

    const result = await orchestrator.handleRequest({
      appId: 'cli_stage_c',
      query: '在这张表新增记录',
    });

    expect(result.intent.kind).toBe('write_request');
    expect(result.needClarification).toBe(false);
    expect(result.executionPlan.steps[1]).toMatchObject({
      toolName: 'feishu_create_records',
      input: {
        appId: 'cli_stage_c',
        baseId: 'app_sales',
        tableId: 'tbl_order',
      },
    });
    expect(result.message).toContain('feishu_create_records');
  });

  it('asks for clarification when write action is still ambiguous', async () => {
    const store = new FeishuSessionStore();
    seedConnectedStore(store);
    store.setRecentContext('cli_stage_c', {
      appId: 'cli_stage_c',
      baseId: 'app_sales',
      baseName: '销售Base',
      tableId: 'tbl_order',
      tableName: '订单表',
      updatedAt: Date.now(),
    });
    const orchestrator = createOrchestrator(store);

    const result = await orchestrator.handleRequest({
      appId: 'cli_stage_c',
      query: '帮我更新记录',
    });

    expect(result.intent.kind).toBe('write_request');
    expect(result.needClarification).toBe(true);
    expect(result.clarificationQuestion).toContain('补充明确的写入动作');
    expect(result.executionPlan.steps[1]?.toolName).toBe('feishu_handle_request');
  });

  it('updates recent Base/Table/field context after structured tool calls', async () => {
    const store = new FeishuSessionStore();
    seedConnectedStore(store);
    const adapter = new MockStageCAdapter();
    const baseService = new FeishuBaseService(adapter, new FeishuAuthService(adapter, store), store);

    await baseService.listTables({
      appId: 'cli_stage_c',
      baseId: 'app_sales',
    });
    await baseService.getTableSchema({
      appId: 'cli_stage_c',
      baseId: 'app_sales',
      tableId: 'tbl_order',
    });
    await baseService.queryRecords({
      appId: 'cli_stage_c',
      baseId: 'app_sales',
      tableId: 'tbl_order',
      pageSize: 10,
    });

    expect(store.getRecentContext('cli_stage_c')).toMatchObject({
      appId: 'cli_stage_c',
      baseId: 'app_sales',
      tableId: 'tbl_order',
      tableName: '订单表',
      intent: 'query_records',
    });
    expect(store.getRecentContext('cli_stage_c')?.fieldNames).toContain('客户名称');
  });

  it('asks for appId when the natural language request needs a fresh connection', async () => {
    const store = new FeishuSessionStore();
    const orchestrator = createOrchestrator(store);

    const result = await orchestrator.handleRequest({
      query: '列出我的 Base',
    });

    expect(result.needClarification).toBe(true);
    expect(result.message).toContain('通常只需要提供 appId');
    expect(result.clarificationQuestion).toContain('补充 appId');
  });

  it('registers the natural language tool and returns structured json', async () => {
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
