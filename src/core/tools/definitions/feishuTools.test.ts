import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toolRegistry } from '../registry';
import { registerBuiltinTools } from '../builtins';
import { feishuFacade } from '../../feishu/facade';

registerBuiltinTools();

describe('feishu tools', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('registers stage A feishu tools', () => {
    expect(toolRegistry.get('feishu_setup_cli')).toBeDefined();
    expect(toolRegistry.get('feishu_connect')).toBeDefined();
    expect(toolRegistry.get('feishu_auth_status')).toBeDefined();
    expect(toolRegistry.get('feishu_disconnect')).toBeDefined();
    expect(toolRegistry.get('feishu_create_records')).toBeDefined();
    expect(toolRegistry.get('feishu_upsert_records')).toBeDefined();
    expect(toolRegistry.get('feishu_update_records_by_filter')).toBeDefined();
    expect(toolRegistry.get('feishu_handle_request')).toBeDefined();
  });

  it('describes feishu_handle_request as planning-only', () => {
    const tool = toolRegistry.get('feishu_handle_request');

    expect(tool?.description).toContain('执行规划');
    expect(tool?.description).toContain('不会直接执行查询或写入');
    expect(tool?.description).toContain('结构化工具');
  });

  it('feishu_setup_cli returns structured json', async () => {
    vi.spyOn(feishuFacade, 'setupCli').mockResolvedValue({
      success: true,
      phase: 'config_pending',
      configUrl: 'https://open.feishu.cn/config',
      command: 'lark-cli config init --new',
      message: '等待配置',
      nextAction: '打开链接',
      lastUpdatedAt: 1,
    });

    const result = await toolRegistry.get('feishu_setup_cli')!.execute({
      installCli: true,
      installSkill: true,
      initializeConfig: true,
    });

    const parsed = JSON.parse(result as string) as { phase: string; configUrl?: string };
    expect(feishuFacade.setupCli).toHaveBeenCalledWith(expect.objectContaining({
      installCli: true,
      installSkill: true,
      initializeConfig: true,
    }));
    expect(parsed.phase).toBe('config_pending');
    expect(parsed.configUrl).toBe('https://open.feishu.cn/config');
  });

  it('feishu_connect returns structured json', async () => {
    vi.spyOn(feishuFacade, 'connect').mockResolvedValue({
      success: false,
      connected: false,
      state: 'approval_pending',
      phase: 'waiting_user_confirm',
      message: '等待确认',
      nextAction: '去飞书确认',
      appId: 'cli_x',
      domain: 'https://open.feishu.cn',
      account: null,
      tenant: null,
      authUrl: 'https://open.feishu.cn/mock',
      expiresAt: null,
      lastUpdatedAt: 1,
    });

    const result = await toolRegistry.get('feishu_connect')!.execute({
      appId: 'cli_x',
      appSecret: 'sec',
    });

    const parsed = JSON.parse(result as string) as { state: string; authUrl?: string };
    expect(parsed.state).toBe('approval_pending');
    expect(parsed.authUrl).toBe('https://open.feishu.cn/mock');
  });

  it('feishu_connect does not require app secret and redacts sensitive output', async () => {
    vi.spyOn(feishuFacade, 'connect').mockResolvedValue({
      success: false,
      connected: false,
      state: 'unauthorized',
      phase: 'failed',
      message: 'failed with app_secret=secret_demo token=token_demo email=tom@example.com phone=13800138000',
      nextAction: '检查配置',
      appId: 'cli_x',
      domain: 'https://open.feishu.cn',
      account: null,
      tenant: null,
      expiresAt: null,
      lastUpdatedAt: 1,
    });

    const result = await toolRegistry.get('feishu_connect')!.execute({
      appId: 'cli_x',
    });
    const output = result as string;

    expect(feishuFacade.connect).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'cli_x',
      appSecret: undefined,
    }));
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('[REDACTED_EMAIL]');
    expect(output).toContain('[REDACTED_PHONE]');
    expect(output).not.toContain('secret_demo');
    expect(output).not.toContain('token_demo');
    expect(output).not.toContain('tom@example.com');
    expect(output).not.toContain('13800138000');
  });

  it('feishu_auth_status returns cached status as json', async () => {
    vi.spyOn(feishuFacade, 'getAuthStatus').mockResolvedValue({
      success: true,
      connected: true,
      state: 'connected',
      phase: 'connected',
      message: '已连接',
      nextAction: '继续使用',
      appId: 'cli_x',
      domain: 'https://open.feishu.cn',
      account: { name: 'Tom' },
      tenant: null,
      authUrl: undefined,
      expiresAt: null,
      lastUpdatedAt: 2,
    });

    const result = await toolRegistry.get('feishu_auth_status')!.execute({
      appId: 'cli_x',
    });

    const parsed = JSON.parse(result as string) as { connected: boolean; account?: { name?: string } };
    expect(parsed.connected).toBe(true);
    expect(parsed.account?.name).toBe('Tom');
  });

  it('feishu_handle_request returns structured json', async () => {
    vi.spyOn(feishuFacade, 'handleRequest').mockResolvedValue({
      intent: {
        kind: 'query_records',
        confidence: 'high',
        query: '帮我查客户表最近 5 条记录',
        slots: [],
        missingSlots: [],
      },
      resolvedContext: {
        base: { id: 'app_sales', name: '销售Base' },
        table: { id: 'tbl_customer', name: '客户表', baseId: 'app_sales' },
      },
      needClarification: false,
      executionPlan: {
        intent: 'query_records',
        steps: [],
      },
      result: {
        records: [{ recordId: 'rec_1', Name: 'Tom' }],
        hasMore: false,
        pageToken: null,
      },
      message: '已返回 1 条记录。',
    });

    const result = await toolRegistry.get('feishu_handle_request')!.execute({
      query: '帮我查客户表最近 5 条记录',
    });

    const parsed = JSON.parse(result as string) as { intent: { kind: string }; result: { records: Array<{ recordId: string }> } };
    expect(parsed.intent.kind).toBe('query_records');
    expect(parsed.result.records[0]?.recordId).toBe('rec_1');
  });

  it('feishu_create_records returns structured json', async () => {
    vi.spyOn(feishuFacade, 'createRecords').mockResolvedValue({
      success: true,
      action: 'create',
      baseId: 'app_sales',
      tableId: 'tbl_customer',
      successCount: 1,
      failureCount: 0,
      createdCount: 1,
      failures: [],
      message: '已成功新增 1 条记录。',
      confirmation: {
        required: false,
        confirmed: false,
        threshold: 20,
      },
      audit: {
        action: 'create',
        baseId: 'app_sales',
        tableId: 'tbl_customer',
        successCount: 1,
        failureCount: 0,
        createdCount: 1,
        timestamp: 1,
      },
    });

    const result = await toolRegistry.get('feishu_create_records')!.execute({
      baseId: 'app_sales',
      tableId: 'tbl_customer',
      records: [{ 客户名称: 'Tom' }],
    });

    const parsed = JSON.parse(result as string) as { action: string; createdCount?: number; audit?: { tableId?: string } };
    expect(parsed.action).toBe('create');
    expect(parsed.createdCount).toBe(1);
    expect(parsed.audit?.tableId).toBe('tbl_customer');
  });
});
