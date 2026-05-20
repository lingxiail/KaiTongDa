import { describe, expect, it } from 'vitest';
import { FEISHU_ERROR_CODES } from './errorCodes';
import { FeishuAuthService } from './authService';
import { FeishuSessionStore } from './sessionStore';
import type { FeishuCliAdapter, FeishuCliLoginHandle, FeishuCliRawResult } from './cliAdapter';
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

class MockFeishuCliAdapter implements FeishuCliAdapter {
  nodeResult: FeishuCliRawResult = { command: 'node --version', stdout: 'v22.0.0', stderr: '', code: 0 };
  npxResult: FeishuCliRawResult = { command: 'npx --version', stdout: '10.0.0', stderr: '', code: 0 };
  cliResult: FeishuCliRawResult = { command: 'lark-cli --version', stdout: '1.0.23', stderr: '', code: 0 };
  configResult: FeishuCliRawResult = { command: 'lark-cli config init --new', stdout: 'ok', stderr: '', code: 0 };
  loginResult: FeishuCliRawResult = {
    command: 'login',
    stdout: 'Login successful\nname: Tom\nemail: tom@example.com\ntenant_key: tenant_demo',
    stderr: '',
    code: 0,
  };

  async checkNodeVersion(): Promise<FeishuCliRawResult> {
    return this.nodeResult;
  }

  async checkNpxVersion(): Promise<FeishuCliRawResult> {
    return this.npxResult;
  }

  async checkCliVersion(): Promise<FeishuCliRawResult> {
    return this.cliResult;
  }

  async installCli(): Promise<FeishuCliRawResult> {
    return { command: 'install', stdout: 'installed', stderr: '', code: 0 };
  }

  async initializeConfig(): Promise<FeishuCliRawResult> {
    return this.configResult;
  }

  async startLogin(
    _input: FeishuLoginStartInput,
    onOutput?: (line: string, stream: 'stdout' | 'stderr') => void,
  ): Promise<FeishuCliLoginHandle> {
    onOutput?.('Please continue in browser: https://open.feishu.cn/mock-auth', 'stdout');
    return {
      id: 'login-1',
      command: 'login',
      completion: Promise.resolve(this.loginResult),
    };
  }

  async getAuthStatus(): Promise<FeishuCliRawResult> {
    return {
      command: 'auth status',
      stdout: 'Authorized account: Tom (tom@example.com)\ntenant_key: tenant_demo',
      stderr: '',
      code: 0,
    };
  }

  async logout(): Promise<FeishuCliRawResult> {
    return { command: 'logout', stdout: 'ok', stderr: '', code: 0 };
  }

  async listBases(_input?: FeishuListBasesInput): Promise<FeishuCliRawResult> {
    throw new Error('not implemented');
  }

  async listTables(_input: FeishuListTablesInput): Promise<FeishuCliRawResult> {
    throw new Error('not implemented');
  }

  async getTableSchema(_input: FeishuGetTableSchemaInput): Promise<FeishuCliRawResult> {
    throw new Error('not implemented');
  }

  async queryRecords(_input: FeishuQueryRecordsInput): Promise<FeishuCliRawResult> {
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
  it('returns environment error when cli is unavailable', async () => {
    const adapter = new MockFeishuCliAdapter();
    adapter.cliResult = { command: 'cli', stdout: '', stderr: 'not found', code: 1 };
    const service = new FeishuAuthService(adapter, new FeishuSessionStore());

    const result = await service.startLogin({
      appId: 'cli_xxx',
      appSecret: 'secret',
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(FEISHU_ERROR_CODES.CLI_UNAVAILABLE);
  });

  it('returns approval pending when login has started but not finished yet', async () => {
    const adapter = new MockFeishuCliAdapter();
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

  it('can auto install lark-cli after explicit confirmation', async () => {
    const adapter = new MockFeishuCliAdapter();
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

    expect(installed).toBe(true);
    expect(result.success).toBe(true);
  });

  it('connects successfully and caches account summary', async () => {
    const service = new FeishuAuthService(new MockFeishuCliAdapter(), new FeishuSessionStore());

    const result = await service.startLogin({
      appId: 'cli_xxx',
      appSecret: 'secret',
      waitForMs: 50,
    });

    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.state).toBe('connected');
    expect(result.account?.name).toBe('Tom');
    expect(result.tenant?.tenantKey).toBe('tenant_demo');
  });

  it('maps expired auth failures to auth_expired', async () => {
    const adapter = new MockFeishuCliAdapter();
    adapter.loginResult = {
      command: 'login',
      stdout: '',
      stderr: 'token expired',
      code: 1,
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
    const service = new FeishuAuthService(new MockFeishuCliAdapter(), store);
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
