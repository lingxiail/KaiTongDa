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
      'check_cli_version',
      'start_login',
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

  parseJsonResult(raw: FeishuCommandRawResult): unknown {
    const text = raw.stdout.trim();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Lark CLI JSON 解析失败: ${reason}`, {
        cause: error,
      });
    }
  }

  private buildNotImplementedResult(command: string): FeishuCommandRawResult {
    return {
      command,
      stdout: '',
      stderr: 'LarkCliAdapter 尚未实现，当前默认仍使用 LarkMcpAdapter。',
      code: -1,
    };
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
    return this.buildNotImplementedResult(this.buildCommand('node', ['--version']).command);
  }

  async checkCliVersion(): Promise<FeishuCommandRawResult> {
    return this.buildNotImplementedResult(this.buildCommand('lark-cli', ['--version']).command);
  }

  async startLogin(
    _input: FeishuLoginStartInput,
    _onOutput?: (line: string, stream: 'stdout' | 'stderr') => void,
  ): Promise<FeishuConnectorLoginHandle> {
    const command = this.buildCommand('lark-cli', ['auth', 'login', '--recommend']).command;
    return {
      id: 'lark-cli-unimplemented',
      command,
      completion: Promise.resolve(this.buildNotImplementedResult(command)),
    };
  }

  async logout(_appId?: string): Promise<FeishuCommandRawResult> {
    return this.buildNotImplementedResult(this.buildCommand('lark-cli', ['auth', 'logout']).command);
  }

  async listBases(_input?: FeishuListBasesInput): Promise<FeishuCommandRawResult> {
    return this.buildNotImplementedResult(this.buildCommand('lark-cli', ['base', 'list']).command);
  }

  async listTables(_input: FeishuListTablesInput): Promise<FeishuCommandRawResult> {
    return this.buildNotImplementedResult(this.buildCommand('lark-cli', ['base', 'table', 'list']).command);
  }

  async getTableSchema(_input: FeishuGetTableSchemaInput): Promise<FeishuCommandRawResult> {
    return this.buildNotImplementedResult(this.buildCommand('lark-cli', ['base', 'field', 'list']).command);
  }

  async queryRecords(_input: FeishuQueryRecordsInput): Promise<FeishuCommandRawResult> {
    return this.buildNotImplementedResult(this.buildCommand('lark-cli', ['base', 'record', 'search']).command);
  }

  async createRecords(input: FeishuCreateRecordsInput): Promise<FeishuRecordWriteResult> {
    return this.buildNotImplementedWriteResult('create', input.baseId, input.tableId);
  }

  async upsertRecords(input: FeishuUpsertRecordsInput): Promise<FeishuRecordWriteResult> {
    return this.buildNotImplementedWriteResult('upsert', input.baseId, input.tableId);
  }

  async updateRecordsByFilter(input: FeishuUpdateRecordsByFilterInput): Promise<FeishuRecordWriteResult> {
    return this.buildNotImplementedWriteResult('update_by_filter', input.baseId, input.tableId);
  }
}

export const larkCliAdapter = new LarkCliAdapter();
