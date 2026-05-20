import { describe, expect, it, vi } from 'vitest';
import { FeishuAuthService } from '../core/feishu/authService';
import { assessCliCompatibility } from '../core/feishu/compat';
import { LarkMcpCliAdapter } from '../core/feishu/cliAdapter';
import type { FeishuCliAdapter, FeishuCliLoginHandle, FeishuCliRawResult } from '../core/feishu/cliAdapter';
import { detectFeishuEnvironment } from '../core/feishu/env';
import { FeishuResultNormalizer } from '../core/feishu/resultNormalizer';
import { FeishuSessionStore } from '../core/feishu/sessionStore';
import { FeishuToolMapper } from '../core/feishu/toolMapper';
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

class MockStageEAdapter implements FeishuCliAdapter {
  constructor(
    private readonly cliVersion = '1.0.23',
    private readonly loginOutput = 'Login successful\nname: Tom\nemail: tom@example.com\ntenant_key: tenant_demo',
  ) {}

  async checkNodeVersion(): Promise<FeishuCliRawResult> {
    return { command: 'node --version', stdout: 'v22.0.0', stderr: '', code: 0 };
  }

  async checkNpxVersion(): Promise<FeishuCliRawResult> {
    return { command: 'npx --version', stdout: '10.0.0', stderr: '', code: 0 };
  }

  async checkCliVersion(): Promise<FeishuCliRawResult> {
    return { command: 'lark-cli --version', stdout: this.cliVersion, stderr: '', code: 0 };
  }

  async installCli(): Promise<FeishuCliRawResult> {
    return { command: 'install', stdout: 'installed', stderr: '', code: 0 };
  }

  async initializeConfig(): Promise<FeishuCliRawResult> {
    return { command: 'config', stdout: 'ok', stderr: '', code: 0 };
  }

  async startLogin(_input: FeishuLoginStartInput, onOutput?: (line: string, stream: 'stdout' | 'stderr') => void): Promise<FeishuCliLoginHandle> {
    onOutput?.('Please continue in browser: https://open.feishu.cn/mock-auth', 'stdout');
    return {
      id: 'login-stage-e',
      command: 'login',
      completion: Promise.resolve({
        command: 'login',
        stdout: this.loginOutput,
        stderr: '',
        code: 0,
      }),
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

describe('Feishu stage E integration', () => {
  it('assesses tested and untested cli versions', () => {
    expect(assessCliCompatibility('0.5.1').status).toBe('compatible');
    expect(assessCliCompatibility('1.0.23').status).toBe('untested');
  });

  it('detects environment with compatibility metadata', async () => {
    const env = await detectFeishuEnvironment(new MockStageEAdapter('0.5.1'));
    expect(env.nodeAvailable).toBe(true);
    expect(env.npxAvailable).toBe(true);
    expect(env.cliAvailable).toBe(true);
    expect(env.compatibility?.status).toBe('compatible');
  });

  it('parses auth account and tenant summary from login output', async () => {
    const service = new FeishuAuthService(new MockStageEAdapter(), new FeishuSessionStore());
    const result = await service.startLogin({
      appId: 'cli_stage_e',
      appSecret: 'secret',
      waitForMs: 50,
    });

    expect(result.success).toBe(true);
    expect(result.account?.name).toBe('Tom');
    expect(result.account?.email).toBe('tom@example.com');
    expect(result.tenant?.tenantKey).toBe('tenant_demo');
  });

  it('normalizes base list, schema, records and write results with tolerant payload shapes', () => {
    const normalizer = new FeishuResultNormalizer();

    const baseResult = normalizer.toPagedResult(
      normalizer.parseJsonPayload(JSON.stringify({
        data: {
          files: [{ file_token: 'app_sales', title: '销售Base', type: 'bitable' }],
          hasMore: false,
        },
      })),
      (item) => normalizer.normalizeBase(item),
    );

    const schemaResult = normalizer.toPagedResult(
      normalizer.parseJsonPayload(JSON.stringify({
        data: {
          fields: [{
            id: 'fld_level',
            name: '等级',
            ui_type: 'text',
            writable: true,
            property: { options: [{ name: 'A' }, { name: 'B' }] },
          }],
        },
      })),
      (item) => normalizer.normalizeField(item),
    );

    const queryResult = normalizer.normalizeRecordQueryResult(normalizer.parseJsonPayload(JSON.stringify({
      data: {
        records: [{ id: 'rec_1', fields: { 客户名称: 'Tom' } }],
        total_count: 1,
      },
    })));

    const writeCount = normalizer.extractWriteSuccessCount(normalizer.parseJsonPayload(JSON.stringify({
      data: {
        records: [{ record_id: 'rec_1' }, { record_id: 'rec_2' }],
      },
    })), 0);

    expect(baseResult.items[0]?.id).toBe('app_sales');
    expect(schemaResult.items[0]?.options).toEqual(['A', 'B']);
    expect(queryResult.records[0]?.recordId).toBe('rec_1');
    expect(writeCount).toBe(2);
  });

  it('surfaces Feishu API errors instead of normalizing them as empty results', () => {
    const normalizer = new FeishuResultNormalizer();
    const payload = normalizer.parseJsonPayload(JSON.stringify({
      code: 1254030,
      msg: 'No permission to access this resource',
    }));

    expect(() => normalizer.toPagedResult(payload, (item) => normalizer.normalizeBase(item)))
      .toThrow('飞书请求失败(1254030): No permission to access this resource');
  });

  it('passes folder token to the Drive file list MCP tool', async () => {
    type InvokeMcpToolProbe = {
      invokeMcpTool: (
        appId: string | undefined,
        toolName: string,
        args: Record<string, unknown>,
      ) => Promise<FeishuCliRawResult>;
    };
    const adapter = new LarkMcpCliAdapter();
    const invokeSpy = vi.spyOn(adapter as unknown as InvokeMcpToolProbe, 'invokeMcpTool').mockResolvedValue({
      command: 'drive.v1.file.list',
      stdout: JSON.stringify({ data: { files: [], has_more: false } }),
      stderr: '',
      code: 0,
    });

    await adapter.listBases({
      appId: 'cli_stage_e',
      folderToken: 'fld_team',
      pageSize: 20,
      pageToken: 'next',
    });

    expect(invokeSpy).toHaveBeenCalledWith('cli_stage_e', 'drive.v1.file.list', {
      params: {
        folder_token: 'fld_team',
        page_size: 20,
        page_token: 'next',
      },
      useUAT: true,
    });
  });

  it('keeps natural language mapping stable for typical query request', () => {
    const mapper = new FeishuToolMapper();
    const intent = mapper.mapIntent('帮我查飞书客户表最近 10 条记录');

    expect(intent.kind).toBe('query_records');
    expect(intent.slots.find((slot) => slot.name === 'tableName')?.value).toBe('客户');
    expect(intent.slots.find((slot) => slot.name === 'limit')?.value).toBe(10);
  });

  it('extracts Feishu base tokens from direct table-list requests', () => {
    const mapper = new FeishuToolMapper();
    const intent = mapper.mapIntent('列出LmXDbh8aCa1muPszAlgcCiXcnkh下的数据表');

    expect(intent.kind).toBe('list_tables');
    expect(intent.slots.find((slot) => slot.name === 'baseId')?.value).toBe('LmXDbh8aCa1muPszAlgcCiXcnkh');
  });
});
