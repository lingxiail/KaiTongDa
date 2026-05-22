import { beforeEach, describe, expect, it } from 'vitest';
import { FEISHU_ERROR_CODES } from './errorCodes';
import { FeishuAuthService } from './authService';
import { FeishuSessionStore } from './sessionStore';
import type { FeishuCommandRawResult, FeishuConnectorAdapter, FeishuConnectorLoginHandle } from './connectorAdapter';
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
} from './types';

class MockFeishuConnectorAdapter implements FeishuConnectorAdapter {
  nodeResult: FeishuCommandRawResult = { command: 'node --version', stdout: 'v22.0.0', stderr: '', code: 0 };
  npxResult: FeishuCommandRawResult = { command: 'npx --version', stdout: '10.0.0', stderr: '', code: 0 };
  cliResult: FeishuCommandRawResult = { command: 'lark-cli --version', stdout: '1.0.23', stderr: '', code: 0 };
  configResult: FeishuCommandRawResult = { command: 'lark-cli config init --new', stdout: 'ok', stderr: '', code: 0 };
  loginResult: FeishuCommandRawResult = {
    command: 'login',
    stdout: 'Login successful\nname: Tom\nemail: tom@example.com\ntenant_key: tenant_demo',
    stderr: '',
    code: 0,
  };

  async checkNodeVersion(): Promise<FeishuCommandRawResult> {
    return this.nodeResult;
  }

  async checkNpxVersion(): Promise<FeishuCommandRawResult> {
    return this.npxResult;
  }

  async checkCliVersion(): Promise<FeishuCommandRawResult> {
    return this.cliResult;
  }

  async installCli(): Promise<FeishuCommandRawResult> {
    return { command: 'install', stdout: 'installed', stderr: '', code: 0 };
  }

  async initializeConfig(): Promise<FeishuCommandRawResult> {
    return this.configResult;
  }

  async startLogin(
    input: FeishuLoginStartInput,
    onOutput?: (line: string, stream: 'stdout' | 'stderr') => void,
  ): Promise<FeishuConnectorLoginHandle> {
    onOutput?.('Please continue in browser: https://open.feishu.cn/mock-auth', 'stdout');
    if (input.noWait) {
      return {
        id: 'login-1',
        command: 'login --no-wait',
        completion: Promise.resolve({
          command: 'login --no-wait',
          stdout: JSON.stringify({ verification_url: 'https://open.feishu.cn/mock-auth', device_code: 'DEVICE_123' }),
          stderr: '',
          code: 0,
        }),
      };
    }
    return {
      id: 'login-1',
      command: 'login',
      completion: Promise.resolve(this.loginResult),
    };
  }

  async getAuthStatus(): Promise<FeishuCommandRawResult> {
    return {
      command: 'auth status',
      stdout: 'Authorized account\nname: Tom\nemail: tom@example.com\ntenant_key: tenant_demo',
      stderr: '',
      code: 0,
    };
  }

  async logout(): Promise<FeishuCommandRawResult> {
    return { command: 'logout', stdout: 'ok', stderr: '', code: 0 };
  }

  async listBases(_input?: FeishuListBasesInput): Promise<FeishuCommandRawResult> {
    throw new Error('not implemented');
  }

  async listTables(_input: FeishuListTablesInput): Promise<FeishuCommandRawResult> {
    throw new Error('not implemented');
  }

  async getTableSchema(_input: FeishuGetTableSchemaInput): Promise<FeishuCommandRawResult> {
    throw new Error('not implemented');
  }

  async queryRecords(_input: FeishuQueryRecordsInput): Promise<FeishuCommandRawResult> {
    throw new Error('not implemented');
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

describe('FeishuAuthService', () => {
  beforeEach(() => {
    const store = new FeishuSessionStore();
    store.clear('cli_xxx');
  });

  it('returns environment error when cli is unavailable', async () => {
    const adapter = new MockFeishuConnectorAdapter();
    adapter.cliResult = { command: 'cli', stdout: '', stderr: 'not found', code: 1 };
    let installed = false;
    adapter.installCli = async () => {
      installed = true;
      return { command: 'install', stdout: 'installed', stderr: '', code: 0 };
    };
    const service = new FeishuAuthService(adapter, new FeishuSessionStore());

    const result = await service.startLogin({
      appId: 'cli_xxx',
      appSecret: 'secret',
      confirmInstall: true,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(FEISHU_ERROR_CODES.CLI_UNAVAILABLE);
    expect(result.nextAction).toContain('feishu_setup_cli');
    expect(installed).toBe(false);
  });

  it('returns connected immediately when lark-cli is already authenticated', async () => {
    const adapter = new MockFeishuConnectorAdapter();
    let configStarted = false;
    let loginStarted = false;
    adapter.initializeConfig = async () => {
      configStarted = true;
      return { command: 'lark-cli config init --new', stdout: 'ok', stderr: '', code: 0 };
    };
    adapter.startLogin = async () => {
      loginStarted = true;
      return {
        id: 'login-1',
        command: 'login --no-wait',
        completion: Promise.resolve({ command: 'login --no-wait', stdout: '', stderr: '', code: 0 }),
      };
    };
    const service = new FeishuAuthService(adapter, new FeishuSessionStore());

    const result = await service.startLogin({
      appId: 'cli_xxx',
      appSecret: 'secret',
    });

    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.state).toBe('connected');
    expect(result.account?.name).toBe('Tom');
    expect(configStarted).toBe(false);
    expect(loginStarted).toBe(false);
  });

  it('does not require app secret for lark-cli browser configuration flow', async () => {
    const adapter = new MockFeishuConnectorAdapter();
    adapter.getAuthStatus = async () => ({
      command: 'auth status',
      stdout: '',
      stderr: 'No user logged in',
      code: 1,
    });
    adapter.startLogin = async (_input, onOutput) => {
      onOutput?.('Please continue in browser: https://open.feishu.cn/mock-auth', 'stdout');
      return {
        id: 'login-pending',
        command: 'login --no-wait',
        completion: new Promise(() => {}),
      };
    };
    const service = new FeishuAuthService(adapter, new FeishuSessionStore());

    const result = await service.startLogin({
      appId: 'cli_xxx',
      waitForMs: 5,
    });

    expect(result.state).toBe('approval_pending');
    expect(result.authUrl).toBe('https://open.feishu.cn/mock-auth');
  });

  it('returns approval pending when login has started but not finished yet', async () => {
    const adapter = new MockFeishuConnectorAdapter();
    adapter.getAuthStatus = async () => ({
      command: 'auth status',
      stdout: '',
      stderr: 'No user logged in',
      code: 1,
    });
    adapter.startLogin = async (_input, onOutput) => {
      onOutput?.('Please continue in browser: https://open.feishu.cn/mock-auth', 'stdout');
      return {
        id: 'login-pending',
        command: 'login',
        completion: new Promise(() => {}),
      };
    };
    const service = new FeishuAuthService(adapter, new FeishuSessionStore());

    const result = await service.startLogin({
      appId: 'cli_xxx',
      appSecret: 'secret',
      waitForMs: 5,
    });

    expect(result.state).toBe('approval_pending');
    expect(result.authUrl).toBe('https://open.feishu.cn/mock-auth');
  });

  it('returns pending authUrl when cli prints url before timeout exit', async () => {
    const adapter = new MockFeishuConnectorAdapter();
    adapter.getAuthStatus = async () => ({
      command: 'auth status',
      stdout: '',
      stderr: 'No user logged in',
      code: 1,
    });
    adapter.startLogin = async () => {
      return {
        id: 'login-timeout-url',
        command: 'login --no-wait',
        completion: Promise.resolve({
          command: 'login --no-wait',
          stdout: 'Open https://accounts.feishu.cn/open-apis/authen/v1/index?app_id=cli_xxx to authorize',
          stderr: 'timed out waiting for browser',
          code: 1,
        }),
      };
    };
    const service = new FeishuAuthService(adapter, new FeishuSessionStore());

    const result = await service.startLogin({
      appId: 'cli_xxx',
      domain: ' `https://open.feishu.cn` ',
      waitForMs: 50,
    });

    expect(result.state).toBe('approval_pending');
    expect(result.errorCode).toBe(FEISHU_ERROR_CODES.AUTH_PENDING);
    expect(result.domain).toBe('https://open.feishu.cn');
    expect(result.authUrl).toBe('https://accounts.feishu.cn/open-apis/authen/v1/index?app_id=cli_xxx');
  });

  it('returns config_pending when config init needs browser confirmation', async () => {
    const adapter = new MockFeishuConnectorAdapter();
    adapter.getAuthStatus = async () => ({
      command: 'auth status',
      stdout: '',
      stderr: 'No user logged in',
      code: 1,
    });
    adapter.initializeConfig = async (onOutput) => {
      onOutput?.('或打开以下链接完成配置： https://open.feishu.cn/page/cli?user_code=ABCD-EFGH', 'stdout');
      return {
        command: 'lark-cli config init --new',
        stdout: '正在获取你的应用配置结果...',
        stderr: 'timed out',
        code: 1,
      };
    };
    const service = new FeishuAuthService(adapter, new FeishuSessionStore());

    const result = await service.startLogin({
      appId: 'cli_xxx',
      appSecret: 'secret',
    });

    expect(result.state).toBe('config_pending');
    expect(result.phase).toBe('config_pending');
    expect(result.authUrl).toBe('https://open.feishu.cn/page/cli?user_code=ABCD-EFGH');
    expect(result.nextAction).toContain('feishu_setup_cli');
  });

  it('reuses active login on repeated connect', async () => {
    const adapter = new MockFeishuConnectorAdapter();
    adapter.getAuthStatus = async () => ({
      command: 'auth status',
      stdout: '',
      stderr: 'No user logged in',
      code: 1,
    });
    let loginStarts = 0;
    adapter.startLogin = async (input, onOutput) => {
      loginStarts += 1;
      onOutput?.('Please continue in browser: https://open.feishu.cn/mock-auth', 'stdout');
      return {
        id: `login-${loginStarts}`,
        command: input.noWait ? 'login --no-wait' : 'login',
        completion: new Promise(() => {}),
      };
    };
    const service = new FeishuAuthService(adapter, new FeishuSessionStore());

    const first = await service.startLogin({
      appId: 'cli_xxx',
      appSecret: 'secret',
      waitForMs: 5,
    });
    const second = await service.startLogin({
      appId: 'cli_xxx',
      appSecret: 'secret',
      waitForMs: 5,
    });

    expect(first.state).toBe('approval_pending');
    expect(second.state).toBe('approval_pending');
    expect(second.authUrl).toBe('https://open.feishu.cn/mock-auth');
    expect(loginStarts).toBe(1);
  });

  it('polls auth status and turns pending into connected', async () => {
    const adapter = new MockFeishuConnectorAdapter();
    let authChecks = 0;
    adapter.getAuthStatus = async () => {
      authChecks += 1;
      if (authChecks === 1) {
        return {
          command: 'auth status',
          stdout: '',
          stderr: 'No user logged in',
          code: 1,
        };
      }
      return {
        command: 'auth status',
        stdout: 'Authorized account\nname: Tom\nemail: tom@example.com\ntenant_key: tenant_demo',
        stderr: '',
        code: 0,
      };
    };
    adapter.startLogin = async (_input, onOutput) => {
      onOutput?.('Please continue in browser: https://open.feishu.cn/mock-auth', 'stdout');
      return {
        id: 'login-pending',
        command: 'login --no-wait',
        completion: new Promise(() => {}),
      };
    };
    const service = new FeishuAuthService(adapter, new FeishuSessionStore());

    const pending = await service.startLogin({
      appId: 'cli_xxx',
      appSecret: 'secret',
      waitForMs: 5,
    });
    const connected = await service.pollLoginStatus({ appId: 'cli_xxx' });

    expect(pending.state).toBe('approval_pending');
    expect(connected.state).toBe('connected');
    expect(connected.connected).toBe(true);
  });

  it('guides cli installation to feishu_setup_cli instead of auto installing from connect', async () => {
    const adapter = new MockFeishuConnectorAdapter();
    adapter.cliResult = { command: 'lark-cli --version', stdout: '', stderr: 'not found', code: 1 };
    let installed = false;
    adapter.installCli = async () => {
      installed = true;
      adapter.cliResult = { command: 'lark-cli --version', stdout: '1.0.23', stderr: '', code: 0 };
      return { command: 'install', stdout: 'installed', stderr: '', code: 0 };
    };
    const service = new FeishuAuthService(adapter, new FeishuSessionStore());

    const result = await service.startLogin({
      appId: 'cli_xxx',
      appSecret: 'secret',
      confirmInstall: true,
      waitForMs: 50,
    });

    expect(installed).toBe(false);
    expect(result.state).toBe('unauthorized');
    expect(result.errorCode).toBe(FEISHU_ERROR_CODES.CLI_UNAVAILABLE);
    expect(result.nextAction).toContain('feishu_setup_cli');
  });

  it('polls connected status and caches account summary', async () => {
    const adapter = new MockFeishuConnectorAdapter();
    let authChecks = 0;
    adapter.getAuthStatus = async () => {
      authChecks += 1;
      if (authChecks === 1) {
        return {
          command: 'auth status',
          stdout: '',
          stderr: 'No user logged in',
          code: 1,
        };
      }
      return {
        command: 'auth status',
        stdout: 'Authorized account\nname: Tom\nemail: tom@example.com\ntenant_key: tenant_demo',
        stderr: '',
        code: 0,
      };
    };
    adapter.startLogin = async (_input, onOutput) => {
      onOutput?.('Please continue in browser: https://open.feishu.cn/mock-auth', 'stdout');
      return {
        id: 'login-1',
        command: 'login',
        completion: new Promise(() => {}),
      };
    };
    const service = new FeishuAuthService(adapter, new FeishuSessionStore());

    await service.startLogin({
      appId: 'cli_xxx',
      appSecret: 'secret',
      waitForMs: 5,
    });
    const result = await service.pollLoginStatus({ appId: 'cli_xxx' });

    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.state).toBe('connected');
    expect(result.account?.name).toBe('Tom');
    expect(result.tenant?.tenantKey).toBe('tenant_demo');
  });

  it('maps expired auth failures to auth_expired', async () => {
    const adapter = new MockFeishuConnectorAdapter();
    adapter.getAuthStatus = async () => ({
      command: 'auth status',
      stdout: '',
      stderr: 'No user logged in',
      code: 1,
    });
    adapter.startLogin = async () => {
      return {
        id: 'login-expired',
        command: 'login --no-wait',
        completion: Promise.resolve({
          command: 'login --no-wait',
          stdout: '',
          stderr: 'token expired',
          code: 1,
        }),
      };
    };
    const service = new FeishuAuthService(adapter, new FeishuSessionStore());

    const result = await service.startLogin({
      appId: 'cli_xxx',
      appSecret: 'secret',
      waitForMs: 50,
    });

    expect(result.state).toBe('auth_expired');
    expect(result.errorCode).toBe(FEISHU_ERROR_CODES.AUTH_EXPIRED);
  });

  it('disconnect clears connection state', async () => {
    const store = new FeishuSessionStore();
    const service = new FeishuAuthService(new MockFeishuConnectorAdapter(), store);
    await service.startLogin({
      appId: 'cli_xxx',
      appSecret: 'secret',
      waitForMs: 50,
    });

    const result = await service.disconnect({ appId: 'cli_xxx' });
    const status = await service.checkAuthStatus({ appId: 'cli_xxx' });

    expect(result.success).toBe(true);
    expect(result.connected).toBe(false);
    expect(status.state).toBe('unauthorized');
  });
});
