import {
  buildAuthLoginCommand,
  buildAuthStatusCommand,
  buildCliVersionCommand,
  buildCliInstallCommand,
  buildConfigInitCommand,
  buildCreateRecordsCommand,
  buildGetTableSchemaCommand,
  buildListBasesCommand,
  buildListTablesCommand,
  buildLogoutCommand,
  buildNodeVersionCommand,
  buildNpxVersionCommand,
  buildQueryRecordsCommand,
  buildUpdateRecordsCommand,
  buildUpsertRecordsCommand,
} from './larkCliCommands';
import { runArgvCommand, runArgvCommandStreaming } from './argvExecutor';
import { scrubFeishuRawResult, scrubFeishuText } from './scrub';
import type {
  FeishuCommandRawResult,
  FeishuConnectorAdapter,
  FeishuConnectorCapability,
  FeishuConnectorLoginHandle,
} from './connectorAdapter';
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

function buildWriteResult(input: {
  success: boolean;
  action: FeishuRecordWriteResult['action'];
  baseId: string;
  tableId: string;
  message: string;
}): FeishuRecordWriteResult {
  return {
    success: input.success,
    action: input.action,
    baseId: input.baseId,
    tableId: input.tableId,
    successCount: 0,
    failureCount: 0,
    failures: [],
    message: input.message,
  };
}

export class LarkCliAdapter implements FeishuConnectorAdapter {
  readonly kind = 'lark_cli' as const;

  getCapabilities(): FeishuConnectorCapability[] {
    return [
      'check_node_version',
      'check_npx_version',
      'check_cli_version',
      'install_cli',
      'initialize_config',
      'start_login',
      'get_auth_status',
      'logout',
      'list_bases',
      'list_tables',
      'get_table_schema',
      'query_records',
      'create_records',
      'upsert_records',
      'update_records_by_filter',
    ];
  }

  buildCommand(program: string, args: string[]): { program: string; args: string[]; command: string } {
    return {
      program,
      args,
      command: [program, ...args].join(' ').trim(),
    };
  }

  private async runCommand(
    command: { program: string; args: string[]; command: string },
    timeout = 60,
  ): Promise<FeishuCommandRawResult> {
    try {
      return scrubFeishuRawResult(await runArgvCommand(command, timeout));
    } catch (error) {
      return {
        command: command.command,
        stdout: '',
        stderr: scrubFeishuText(error instanceof Error ? error.message : String(error)),
        code: -1,
      };
    }
  }

  parseJsonResult(raw: FeishuCommandRawResult): unknown {
    const text = raw.stdout.trim();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      const reason = scrubFeishuText(error instanceof Error ? error.message : String(error));
      throw new Error(`Lark CLI JSON 解析失败: ${reason}`, {
        cause: error,
      });
    }
  }

  private buildNotImplementedWriteResult(
    action: FeishuRecordWriteResult['action'],
    baseId: string,
    tableId: string,
  ): FeishuRecordWriteResult {
    return buildWriteResult({
      success: false,
      action,
      baseId,
      tableId,
      message: 'LarkCliAdapter 尚未实现，当前默认仍使用 LarkMcpAdapter。',
    });
  }

  async checkNodeVersion(): Promise<FeishuCommandRawResult> {
    return await this.runCommand(buildNodeVersionCommand(), 20);
  }

  async checkNpxVersion(): Promise<FeishuCommandRawResult> {
    return await this.runCommand(buildNpxVersionCommand(), 20);
  }

  async checkCliVersion(): Promise<FeishuCommandRawResult> {
    return await this.runCommand(buildCliVersionCommand(), 30);
  }

  async installCli(): Promise<FeishuCommandRawResult> {
    return await this.runCommand(buildCliInstallCommand(), 240);
  }

  async initializeConfig(): Promise<FeishuCommandRawResult> {
    return await this.runCommand(buildConfigInitCommand(), 90);
  }

  async startLogin(
    input: FeishuLoginStartInput,
    onOutput?: (line: string, stream: 'stdout' | 'stderr') => void,
  ): Promise<FeishuConnectorLoginHandle> {
    const command = buildAuthLoginCommand(input);
    return {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `lark-cli-login-${Date.now()}`,
      command: command.command,
      completion: runArgvCommandStreaming(command, input.timeoutSec ?? 240, onOutput).catch((error) => ({
        command: command.command,
        stdout: '',
        stderr: scrubFeishuText(error instanceof Error ? error.message : String(error)),
        code: -1,
      })),
    };
  }

  async getAuthStatus(_appId?: string): Promise<FeishuCommandRawResult> {
    return await this.runCommand(buildAuthStatusCommand(), 30);
  }

  async logout(_appId?: string): Promise<FeishuCommandRawResult> {
    return await this.runCommand(buildLogoutCommand(), 30);
  }

  async listBases(_input?: FeishuListBasesInput): Promise<FeishuCommandRawResult> {
    return await this.runCommand(buildListBasesCommand(_input), 60);
  }

  async listTables(_input: FeishuListTablesInput): Promise<FeishuCommandRawResult> {
    return await this.runCommand(buildListTablesCommand(_input), 60);
  }

  async getTableSchema(_input: FeishuGetTableSchemaInput): Promise<FeishuCommandRawResult> {
    return await this.runCommand(buildGetTableSchemaCommand(_input), 60);
  }

  async queryRecords(_input: FeishuQueryRecordsInput): Promise<FeishuCommandRawResult> {
    return await this.runCommand(buildQueryRecordsCommand(_input), 90);
  }

  async createRecords(input: FeishuCreateRecordsInput): Promise<FeishuRecordWriteResult> {
    void buildCreateRecordsCommand(input);
    return this.buildNotImplementedWriteResult('create', input.baseId, input.tableId);
  }

  async upsertRecords(input: FeishuUpsertRecordsInput): Promise<FeishuRecordWriteResult> {
    void buildUpsertRecordsCommand(input);
    return this.buildNotImplementedWriteResult('upsert', input.baseId, input.tableId);
  }

  async updateRecordsByFilter(input: FeishuUpdateRecordsByFilterInput): Promise<FeishuRecordWriteResult> {
    void buildUpdateRecordsCommand(input);
    return this.buildNotImplementedWriteResult('update_by_filter', input.baseId, input.tableId);
  }
}

export const larkCliAdapter = new LarkCliAdapter();
