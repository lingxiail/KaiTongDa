import {
  buildAuthLoginCommand,
  buildAuthStatusCommand,
  buildCliVersionCommand,
  buildCliInstallCommand,
  buildSkillInstallCommand,
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
import { feishuResultNormalizer } from './resultNormalizer';
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

function buildSuccessMessage(input: {
  action: FeishuRecordWriteResult['action'];
  createdCount?: number;
  updatedCount?: number;
  matchedCount?: number;
  successCount: number;
  failureCount: number;
}): string {
  if (input.action === 'create') {
    return input.failureCount === 0
      ? `已成功新增 ${input.successCount} 条记录。`
      : `已新增 ${input.successCount} 条记录，另有 ${input.failureCount} 条失败。`;
  }

  if (input.action === 'upsert') {
    const createdCount = input.createdCount ?? 0;
    const updatedCount = input.updatedCount ?? 0;
    return input.failureCount === 0
      ? `upsert 完成：新增 ${createdCount} 条，更新 ${updatedCount} 条。`
      : `upsert 完成：新增 ${createdCount} 条，更新 ${updatedCount} 条，失败 ${input.failureCount} 条。`;
  }

  const matchedCount = input.matchedCount ?? input.successCount;
  return input.failureCount === 0
    ? `已按条件更新 ${input.successCount} 条记录。`
    : `命中 ${matchedCount} 条记录，成功更新 ${input.successCount} 条，失败 ${input.failureCount} 条。`;
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

  private buildFailedWriteResult(
    action: FeishuRecordWriteResult['action'],
    baseId: string,
    tableId: string,
    failureCount: number,
    error: unknown,
  ): FeishuRecordWriteResult {
    const reason = scrubFeishuText(error instanceof Error ? error.message : String(error));
    return {
      ...buildWriteResult({
        success: false,
        action,
        baseId,
        tableId,
        message: reason,
      }),
      failureCount,
      failures: failureCount > 0 ? [{ index: 0, reason }] : [],
      createdCount: action === 'create' ? 0 : undefined,
      updatedCount: action === 'create' ? undefined : 0,
      matchedCount: action === 'update_by_filter' ? failureCount : undefined,
    };
  }

  private extractCount(payload: unknown, keys: string[]): number | undefined {
    const data = feishuResultNormalizer.unwrapData(payload);
    return feishuResultNormalizer.pickNumber(data, keys);
  }

  private buildWriteResultFromPayload(input: {
    action: FeishuRecordWriteResult['action'];
    baseId: string;
    tableId: string;
    requestedCount: number;
    payload: unknown;
  }): FeishuRecordWriteResult {
    const successCount = feishuResultNormalizer.extractWriteSuccessCount(input.payload, input.requestedCount);

    if (input.action === 'create') {
      const createdCount = this.extractCount(input.payload, ['created_count', 'createdCount', 'success_count', 'total']) ?? successCount;
      const failureCount = Math.max(0, input.requestedCount - createdCount);
      return {
        ...buildWriteResult({
          success: failureCount === 0,
          action: input.action,
          baseId: input.baseId,
          tableId: input.tableId,
          message: buildSuccessMessage({
            action: input.action,
            successCount: createdCount,
            failureCount,
          }),
        }),
        successCount: createdCount,
        failureCount,
        createdCount,
        failures: failureCount > 0 ? [{ index: createdCount, reason: '部分记录未成功创建。' }] : [],
      };
    }

    if (input.action === 'upsert') {
      const createdCount = this.extractCount(input.payload, ['created_count', 'createdCount']) ?? 0;
      const updatedCount = this.extractCount(input.payload, ['updated_count', 'updatedCount']) ?? Math.max(0, successCount - createdCount);
      const matchedCount = this.extractCount(input.payload, ['matched_count', 'matchedCount']) ?? updatedCount;
      const failureCount = Math.max(0, input.requestedCount - successCount);
      return {
        ...buildWriteResult({
          success: failureCount === 0,
          action: input.action,
          baseId: input.baseId,
          tableId: input.tableId,
          message: buildSuccessMessage({
            action: input.action,
            createdCount,
            updatedCount,
            successCount,
            failureCount,
          }),
        }),
        successCount,
        failureCount,
        createdCount,
        updatedCount,
        matchedCount,
        failures: failureCount > 0 ? [{ index: successCount, reason: '部分记录未成功 upsert。' }] : [],
      };
    }

    const matchedCount = this.extractCount(input.payload, ['matched_count', 'matchedCount', 'total', 'success_count']) ?? successCount;
    const updatedCount = this.extractCount(input.payload, ['updated_count', 'updatedCount', 'success_count', 'total']) ?? successCount;
    const failureCount = Math.max(0, matchedCount - updatedCount);
    return {
      ...buildWriteResult({
        success: failureCount === 0,
        action: input.action,
        baseId: input.baseId,
        tableId: input.tableId,
        message: buildSuccessMessage({
          action: input.action,
          matchedCount,
          successCount: updatedCount,
          failureCount,
        }),
      }),
      successCount: updatedCount,
      failureCount,
      updatedCount,
      matchedCount,
      failures: failureCount > 0 ? [{ index: updatedCount, reason: '部分命中记录未成功更新。' }] : [],
    };
  }

  private async runWriteCommand(
    input: {
      action: FeishuRecordWriteResult['action'];
      baseId: string;
      tableId: string;
      requestedCount: number;
      command: { program: string; args: string[]; command: string };
      timeout?: number;
    },
  ): Promise<FeishuRecordWriteResult> {
    if (input.requestedCount === 0 && input.action !== 'update_by_filter') {
      return {
        ...buildWriteResult({
          success: true,
          action: input.action,
          baseId: input.baseId,
          tableId: input.tableId,
          message: input.action === 'create' ? '没有需要新增的记录。' : '没有需要 upsert 的记录。',
        }),
        createdCount: 0,
        updatedCount: input.action === 'upsert' ? 0 : undefined,
        matchedCount: input.action === 'upsert' ? 0 : undefined,
      };
    }

    try {
      const raw = await this.runCommand(input.command, input.timeout ?? 120);
      if (raw.code !== 0) {
        throw new Error(raw.stderr || raw.stdout || '飞书写入失败。');
      }

      return this.buildWriteResultFromPayload({
        action: input.action,
        baseId: input.baseId,
        tableId: input.tableId,
        requestedCount: input.requestedCount,
        payload: this.parseJsonResult(raw),
      });
    } catch (error) {
      return this.buildFailedWriteResult(input.action, input.baseId, input.tableId, input.requestedCount, error);
    }
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

  async installSkill(): Promise<FeishuCommandRawResult> {
    return await this.runCommand(buildSkillInstallCommand(), 240);
  }

  async initializeConfig(onOutput?: (line: string, stream: 'stdout' | 'stderr') => void): Promise<FeishuCommandRawResult> {
    const command = buildConfigInitCommand();
    return scrubFeishuRawResult(await runArgvCommandStreaming(command, 90, onOutput));
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
    return await this.runWriteCommand({
      action: 'create',
      baseId: input.baseId,
      tableId: input.tableId,
      requestedCount: input.records.length,
      command: buildCreateRecordsCommand(input),
      timeout: 120,
    });
  }

  async upsertRecords(input: FeishuUpsertRecordsInput): Promise<FeishuRecordWriteResult> {
    return await this.runWriteCommand({
      action: 'upsert',
      baseId: input.baseId,
      tableId: input.tableId,
      requestedCount: input.records.length,
      command: buildUpsertRecordsCommand(input),
      timeout: 150,
    });
  }

  async updateRecordsByFilter(input: FeishuUpdateRecordsByFilterInput): Promise<FeishuRecordWriteResult> {
    return await this.runWriteCommand({
      action: 'update_by_filter',
      baseId: input.baseId,
      tableId: input.tableId,
      requestedCount: 1,
      command: buildUpdateRecordsCommand(input),
      timeout: 150,
    });
  }
}

export const larkCliAdapter = new LarkCliAdapter();
