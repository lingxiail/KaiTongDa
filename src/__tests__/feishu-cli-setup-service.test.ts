import { describe, expect, it } from 'vitest';
import type { FeishuCommandRawResult, FeishuConnectorAdapter, FeishuConnectorLoginHandle } from '../core/feishu/connectorAdapter';
import { FeishuCliSetupService } from '../core/feishu/setupService';
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

function raw(command: string, stdout = '', stderr = '', code = 0): FeishuCommandRawResult {
  return { command, stdout, stderr, code };
}

class MockSetupAdapter implements FeishuConnectorAdapter {
  readonly kind = 'lark_cli' as const;
  node = raw('node --version', 'v20.0.0');
  npx = raw('npx --version', '10.0.0');
  cliChecks: FeishuCommandRawResult[] = [raw('lark-cli --version', '1.0.23')];
  installCliResult = raw('npm install -g @larksuite/cli', 'installed');
  installSkillResult = raw('npx -y skills add https://open.feishu.cn --skill -y', 'skill installed');
  configResult = raw('lark-cli config init --new', 'open https://open.feishu.cn/config');
  loginResult = raw('lark-cli auth login --recommend', 'open https://open.feishu.cn/auth');
  authStatusResult = raw('lark-cli auth status', 'logged in');

  async checkNodeVersion(): Promise<FeishuCommandRawResult> {
    return this.node;
  }

  async checkNpxVersion(): Promise<FeishuCommandRawResult> {
    return this.npx;
  }

  async checkCliVersion(): Promise<FeishuCommandRawResult> {
    return this.cliChecks.shift() ?? raw('lark-cli --version', '1.0.23');
  }

  async installCli(): Promise<FeishuCommandRawResult> {
    return this.installCliResult;
  }

  async installSkill(): Promise<FeishuCommandRawResult> {
    return this.installSkillResult;
  }

  async initializeConfig(onOutput?: (line: string, stream: 'stdout' | 'stderr') => void): Promise<FeishuCommandRawResult> {
    onOutput?.(this.configResult.stdout, 'stdout');
    return this.configResult;
  }

  async startLogin(
    _input: FeishuLoginStartInput,
    onOutput?: (line: string, stream: 'stdout' | 'stderr') => void,
  ): Promise<FeishuConnectorLoginHandle> {
    onOutput?.(this.loginResult.stdout, 'stdout');
    return {
      id: 'login-1',
      command: this.loginResult.command,
      completion: Promise.resolve(this.loginResult),
    };
  }

  async getAuthStatus(): Promise<FeishuCommandRawResult> {
    return this.authStatusResult;
  }

  async logout(): Promise<FeishuCommandRawResult> {
    return raw('logout');
  }

  async listBases(_input?: FeishuListBasesInput): Promise<FeishuCommandRawResult> {
    return raw('list bases');
  }

  async listTables(_input: FeishuListTablesInput): Promise<FeishuCommandRawResult> {
    return raw('list tables');
  }

  async getTableSchema(_input: FeishuGetTableSchemaInput): Promise<FeishuCommandRawResult> {
    return raw('schema');
  }

  async queryRecords(_input: FeishuQueryRecordsInput): Promise<FeishuCommandRawResult> {
    return raw('query');
  }

  async createRecords(_input: FeishuCreateRecordsInput): Promise<FeishuRecordWriteResult> {
    return this.writeResult('create', _input.baseId, _input.tableId);
  }

  async upsertRecords(_input: FeishuUpsertRecordsInput): Promise<FeishuRecordWriteResult> {
    return this.writeResult('upsert', _input.baseId, _input.tableId);
  }

  async updateRecordsByFilter(_input: FeishuUpdateRecordsByFilterInput): Promise<FeishuRecordWriteResult> {
    return this.writeResult('update_by_filter', _input.baseId, _input.tableId);
  }

  private writeResult(action: FeishuRecordWriteResult['action'], baseId: string, tableId: string): FeishuRecordWriteResult {
    return {
      success: true,
      action,
      baseId,
      tableId,
      successCount: 0,
      failureCount: 0,
      failures: [],
      message: 'ok',
    };
  }
}

describe('FeishuCliSetupService', () => {
  it('returns environment failure when node is missing', async () => {
    const adapter = new MockSetupAdapter();
    adapter.node = raw('node --version', '', 'not found', 1);

    const result = await new FeishuCliSetupService(adapter).setup({ installCli: true });

    expect(result.success).toBe(false);
    expect(result.phase).toBe('failed');
    expect(result.environment?.failureReason).toBe('node_missing');
    expect(result.command).toBe('npm install -g @larksuite/cli');
  });

  it('installs missing cli and skill then reports ready', async () => {
    const adapter = new MockSetupAdapter();
    adapter.cliChecks = [raw('lark-cli --version', '', 'not found', 1), raw('lark-cli --version', '1.0.23')];

    const result = await new FeishuCliSetupService(adapter).setup({ installCli: true, installSkill: true });

    expect(result.success).toBe(true);
    expect(result.phase).toBe('ready');
    expect(result.environment?.cliAvailable).toBe(true);
  });

  it('returns config pending with extracted url', async () => {
    const result = await new FeishuCliSetupService(new MockSetupAdapter()).setup({ initializeConfig: true });

    expect(result.success).toBe(true);
    expect(result.phase).toBe('config_pending');
    expect(result.configUrl).toBe('https://open.feishu.cn/config');
  });

  it('returns login pending with extracted auth url', async () => {
    const result = await new FeishuCliSetupService(new MockSetupAdapter()).setup({ startLogin: true });

    expect(result.success).toBe(true);
    expect(result.phase).toBe('login_pending');
    expect(result.authUrl).toBe('https://open.feishu.cn/auth');
  });

  it('verifies auth status as ready', async () => {
    const result = await new FeishuCliSetupService(new MockSetupAdapter()).setup({ verifyAuth: true });

    expect(result.success).toBe(true);
    expect(result.phase).toBe('ready');
    expect(result.command).toBe('lark-cli auth status');
  });
});
