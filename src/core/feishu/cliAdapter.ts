import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isWindows } from '../../utils/platform';
import type {
  FeishuCreateRecordsInput,
  FeishuLoginStartInput,
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
  listBases(): Promise<FeishuCliRawResult>;
  listTables(baseId: string): Promise<FeishuCliRawResult>;
  getTableSchema(baseId: string, tableId: string): Promise<FeishuCliRawResult>;
  queryRecords(baseId: string, tableId: string, input?: Record<string, unknown>): Promise<FeishuCliRawResult>;
  createRecords(input: FeishuCreateRecordsInput): Promise<FeishuRecordWriteResult>;
  upsertRecords(input: FeishuUpsertRecordsInput): Promise<FeishuRecordWriteResult>;
  updateRecordsByFilter(input: FeishuUpdateRecordsByFilterInput): Promise<FeishuRecordWriteResult>;
}

const DEFAULT_DOMAIN = 'https://open.feishu.cn';
const DEFAULT_LOGIN_PORT = 3000;

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

export class LarkMcpCliAdapter implements FeishuCliAdapter {
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
    return await runArgv('npx', args, 60);
  }

  async listBases(): Promise<FeishuCliRawResult> {
    throw new Error('Not implemented in stage A.');
  }

  async listTables(_baseId: string): Promise<FeishuCliRawResult> {
    throw new Error('Not implemented in stage A.');
  }

  async getTableSchema(_baseId: string, _tableId: string): Promise<FeishuCliRawResult> {
    throw new Error('Not implemented in stage A.');
  }

  async queryRecords(
    _baseId: string,
    _tableId: string,
    _input?: Record<string, unknown>,
  ): Promise<FeishuCliRawResult> {
    throw new Error('Not implemented in stage A.');
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
