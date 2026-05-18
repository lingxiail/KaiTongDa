import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { mcpManager } from '../mcp/client';
import { isWindows } from '../../utils/platform';
import { feishuSessionStore } from './sessionStore';
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

interface CommandOutput {
  stdout: string;
  stderr: string;
  code: number;
}

interface CommandOutputLine {
  stream: 'stdout' | 'stderr';
  line: string;
}

export interface FeishuCliRawResult {
  command: string;
  stdout: string;
  stderr: string;
  code: number;
}

export interface FeishuCliLoginHandle {
  id: string;
  command: string;
  completion: Promise<FeishuCliRawResult>;
}

export interface FeishuCliAdapter {
  checkNodeVersion(): Promise<FeishuCliRawResult>;
  checkCliVersion(): Promise<FeishuCliRawResult>;
  startLogin(
    input: FeishuLoginStartInput,
    onOutput?: (line: string, stream: 'stdout' | 'stderr') => void,
  ): Promise<FeishuCliLoginHandle>;
  logout(appId?: string): Promise<FeishuCliRawResult>;
  listBases(input?: FeishuListBasesInput): Promise<FeishuCliRawResult>;
  listTables(input: FeishuListTablesInput): Promise<FeishuCliRawResult>;
  getTableSchema(input: FeishuGetTableSchemaInput): Promise<FeishuCliRawResult>;
  queryRecords(input: FeishuQueryRecordsInput): Promise<FeishuCliRawResult>;
  createRecords(input: FeishuCreateRecordsInput): Promise<FeishuRecordWriteResult>;
  upsertRecords(input: FeishuUpsertRecordsInput): Promise<FeishuRecordWriteResult>;
  updateRecordsByFilter(input: FeishuUpdateRecordsByFilterInput): Promise<FeishuRecordWriteResult>;
}

const DEFAULT_DOMAIN = 'https://open.feishu.cn';
const DEFAULT_LOGIN_PORT = 3000;
const FEISHU_MCP_TOOLS = [
  'drive.v1.file.list',
  'bitable.v1.app.get',
  'bitable.v1.appTable.list',
  'bitable.v1.appTableField.list',
  'bitable.v1.appTableRecord.search',
].join(' ');
const MCP_SERVER_SIGNATURES = new Map<string, string>();

function quoteShellArg(value: string): string {
  if (isWindows()) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildShellCommand(program: string, args: string[]): string {
  return [quoteShellArg(program), ...args.map(quoteShellArg)].join(' ');
}

function mapResult(command: string, output: CommandOutput): FeishuCliRawResult {
  return {
    command,
    stdout: output.stdout,
    stderr: output.stderr,
    code: output.code,
  };
}

function generateOperationId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function runArgv(program: string, args: string[], timeout = 60): Promise<FeishuCliRawResult> {
  const command = `${program} ${args.join(' ')}`.trim();
  const output = await invoke<CommandOutput>('run_argv_command', {
    program,
    args,
    cwd: null,
    timeout,
    sandboxEnabled: false,
    networkIsolation: false,
  });
  return mapResult(command, output);
}

function normalizeDomain(domain?: string): string {
  return domain?.trim() || DEFAULT_DOMAIN;
}

function createMcpServerName(appId: string, domain?: string): string {
  const normalizedDomain = normalizeDomain(domain).replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  return `__feishu_cli_${appId.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${normalizedDomain}`;
}

function buildMcpArgs(input: { appId: string; appSecret: string; domain?: string }): string[] {
  return [
    '-y',
    '@larksuiteoapi/lark-mcp',
    'mcp',
    '-a',
    input.appId,
    '-s',
    input.appSecret,
    '-d',
    normalizeDomain(input.domain),
    '--oauth',
    '-c',
    'dot',
    '-l',
    'en',
    '-t',
    FEISHU_MCP_TOOLS,
  ];
}

function buildMcpSignature(input: { appId: string; appSecret: string; domain?: string }): string {
  return JSON.stringify({
    appId: input.appId,
    appSecret: input.appSecret,
    domain: normalizeDomain(input.domain),
  });
}

function toRawResult(command: string, value: unknown): FeishuCliRawResult {
  return {
    command,
    stdout: typeof value === 'string' ? value : JSON.stringify(value),
    stderr: '',
    code: 0,
  };
}

function toErrorResult(command: string, error: unknown): FeishuCliRawResult {
  return {
    command,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
    code: -1,
  };
}

export class LarkMcpCliAdapter implements FeishuCliAdapter {
  private getMcpRuntimeConfig(appId?: string): { appId: string; appSecret: string; domain?: string } {
    const runtimeConfig = feishuSessionStore.getRuntimeConfig(appId);
    if (!runtimeConfig.appId || !runtimeConfig.appSecret) {
      throw new Error('缺少飞书运行时凭据，请先执行 feishu_connect 完成授权。');
    }
    return {
      appId: runtimeConfig.appId,
      appSecret: runtimeConfig.appSecret,
      domain: runtimeConfig.domain,
    };
  }

  private async ensureMcpServer(appId?: string): Promise<string> {
    // 懒加载 + 缓存
    const runtimeConfig = this.getMcpRuntimeConfig(appId);
    const serverName = createMcpServerName(runtimeConfig.appId, runtimeConfig.domain);
    const nextSignature = buildMcpSignature(runtimeConfig);
    const prevSignature = MCP_SERVER_SIGNATURES.get(serverName);
    if (!mcpManager.isConnected(serverName) || prevSignature !== nextSignature) {
      await mcpManager.connectServer({
        name: serverName,
        transport: 'stdio',
        command: 'npx',
        args: buildMcpArgs(runtimeConfig),
        timeout: 30000,
      });
      MCP_SERVER_SIGNATURES.set(serverName, nextSignature);
    }
    return serverName;
  }

  private async invokeMcpTool(appId: string | undefined, toolName: string, args: Record<string, unknown>): Promise<FeishuCliRawResult> {
    const serverName = await this.ensureMcpServer(appId);
    const command = `${serverName}:${toolName}`;
    try {
      const result = await mcpManager.callTool(serverName, toolName, args);
      return toRawResult(command, result);
    } catch (error) {
      return toErrorResult(command, error);
    }
  }

  async checkNodeVersion(): Promise<FeishuCliRawResult> {
    return await runArgv('node', ['--version'], 20);
  }

  async checkCliVersion(): Promise<FeishuCliRawResult> {
    const attempts: string[][] = [
      ['-y', '@larksuiteoapi/lark-mcp', '--version'],
      ['-y', '@larksuiteoapi/lark-mcp', '-V'],
    ];

    let lastError: FeishuCliRawResult | null = null;
    for (const args of attempts) {
      try {
        return await runArgv('npx', args, 90);
      } catch (error) {
        lastError = {
          command: `npx ${args.join(' ')}`,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
          code: -1,
        };
      }
    }

    return lastError ?? {
      command: 'npx -y @larksuiteoapi/lark-mcp --version',
      stdout: '',
      stderr: 'Failed to execute lark-mcp version check.',
      code: -1,
    };
  }

  async startLogin(
    input: FeishuLoginStartInput,
    onOutput?: (line: string, stream: 'stdout' | 'stderr') => void,
  ): Promise<FeishuCliLoginHandle> {
    const eventId = generateOperationId();
    const args = [
      '-y',
      '@larksuiteoapi/lark-mcp',
      'login',
      '-a',
      input.appId,
      '-s',
      input.appSecret,
      '-d',
      input.domain || DEFAULT_DOMAIN,
      '-p',
      String(input.port ?? DEFAULT_LOGIN_PORT),
    ];

    if (input.preferredScopes && input.preferredScopes.length > 0) {
      args.push('--scope', ...input.preferredScopes);
    }

    const command = buildShellCommand('npx', args);
    const eventName = `abu://command-output-${eventId}`;
    const unlisten = await listen<CommandOutputLine>(eventName, (event) => {
      onOutput?.(event.payload.line, event.payload.stream);
    });

    const completion = invoke<CommandOutput>('run_shell_command_streaming', {
      command,
      cwd: null,
      timeout: input.timeoutSec ?? 240,
      eventId,
      sandboxEnabled: false,
      networkIsolation: false,
    })
      .then((output) => mapResult(command, output))
      .finally(() => {
        void unlisten();
      });

    return {
      id: eventId,
      command,
      completion,
    };
  }

  async logout(appId?: string): Promise<FeishuCliRawResult> {
    const args = ['-y', '@larksuiteoapi/lark-mcp', 'logout'];
    if (appId) {
      args.push('-a', appId);
    }
    const runtimeConfig = feishuSessionStore.getRuntimeConfig(appId);
    if (runtimeConfig.appId) {
      const serverName = createMcpServerName(runtimeConfig.appId, runtimeConfig.domain);
      if (mcpManager.isConnected(serverName)) {
        await mcpManager.disconnectServer(serverName);
      }
      MCP_SERVER_SIGNATURES.delete(serverName);
    }
    return await runArgv('npx', args, 60);
  }

  async listBases(input?: FeishuListBasesInput): Promise<FeishuCliRawResult> {
    return await this.invokeMcpTool(input?.appId, 'drive.v1.file.list', {
      params: {
        page_size: input?.pageSize,
        page_token: input?.pageToken,
      },
      useUAT: true,
    });
  }

  async listTables(input: FeishuListTablesInput): Promise<FeishuCliRawResult> {
    return await this.invokeMcpTool(input.appId, 'bitable.v1.appTable.list', {
      path: {
        app_token: input.baseId,
      },
      params: {
        page_size: input.pageSize,
        page_token: input.pageToken,
      },
      useUAT: true,
    });
  }

  async getTableSchema(input: FeishuGetTableSchemaInput): Promise<FeishuCliRawResult> {
    return await this.invokeMcpTool(input.appId, 'bitable.v1.appTableField.list', {
      path: {
        app_token: input.baseId,
        table_id: input.tableId,
      },
      params: {
        page_size: input.pageSize,
        page_token: input.pageToken,
      },
      useUAT: true,
    });
  }

  async queryRecords(input: FeishuQueryRecordsInput): Promise<FeishuCliRawResult> {
    return await this.invokeMcpTool(input.appId, 'bitable.v1.appTableRecord.search', {
      path: {
        app_token: input.baseId,
        table_id: input.tableId,
      },
      data: {
        filter: input.filter,
        sort: input.sort?.map((item) => ({
          field_name: item.fieldName,
          desc: item.desc,
        })),
        view_id: input.viewId,
        field_names: input.fieldNames,
        page_size: input.pageSize,
        page_token: input.pageToken,
      },
      useUAT: true,
    });
  }

  async createRecords(_input: FeishuCreateRecordsInput): Promise<FeishuRecordWriteResult> {
    throw new Error('Not implemented in stage A.');
  }

  async upsertRecords(_input: FeishuUpsertRecordsInput): Promise<FeishuRecordWriteResult> {
    throw new Error('Not implemented in stage A.');
  }

  async updateRecordsByFilter(_input: FeishuUpdateRecordsByFilterInput): Promise<FeishuRecordWriteResult> {
    throw new Error('Not implemented in stage A.');
  }
}

export const feishuCliAdapter = new LarkMcpCliAdapter();
