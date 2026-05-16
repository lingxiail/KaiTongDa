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
    expect(toolRegistry.get('feishu_connect')).toBeDefined();
    expect(toolRegistry.get('feishu_auth_status')).toBeDefined();
    expect(toolRegistry.get('feishu_disconnect')).toBeDefined();
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
});
