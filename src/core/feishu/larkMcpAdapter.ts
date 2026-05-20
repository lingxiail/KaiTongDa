import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { mcpManager } from '../mcp/client';
import { isWindows } from '../../utils/platform';
import { buildArgvCommand, runArgvCommand } from './argvExecutor';
import { feishuResultNormalizer } from './resultNormalizer';
import { feishuSessionStore } from './sessionStore';
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
  FeishuWriteAction,
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

const DEFAULT_DOMAIN = 'https://open.feishu.cn';
const DEFAULT_LOGIN_PORT = 3000;
const FEISHU_MCP_TOOLS = [
  'drive.v1.file.list',
  'bitable.v1.app.get',
  'bitable.v1.appTable.list',
  'bitable.v1.appTableField.list',
  'bitable.v1.appTableRecord.search',
  'bitable.v1.appTableRecord.batchCreate',
  'bitable.v1.appTableRecord.batchUpdate',
].join(' ');
const MCP_SERVER_SIGNATURES = new Map<string, string>();

function buildWriteResult(input: {
  success: boolean;
  action: FeishuWriteAction;
  baseId: string;
  tableId: string;
  successCount: number;
  failureCount: number;
  createdCount?: number;
  updatedCount?: number;
  matchedCount?: number;
  failures?: Array<{ index: number; reason: string }>;
  message: string;
}): FeishuRecordWriteResult {
  return {
    success: input.success,
    action: input.action,
    baseId: input.baseId,
    tableId: input.tableId,
    successCount: input.successCount,
    failureCount: input.failureCount,
    createdCount: input.createdCount,
    updatedCount: input.updatedCount,
    matchedCount: input.matchedCount,
    failures: input.failures ?? [],
    message: input.message,
  };
}

function makeMatchKey(fields: Record<string, unknown>, matchByFields: string[]): string | null {
  const parts: string[] = [];
  for (const fieldName of matchByFields) {
    if (!(fieldName in fields)) {
      return null;
    }
    parts.push(`${fieldName}:${JSON.stringify(fields[fieldName])}`);
  }
  return parts.join('|');
}

function quoteShellArg(value: string): string {
  if (isWindows()) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildShellCommand(program: string, args: string[]): string {
  const command = [quoteShellArg(program), ...args.map(quoteShellArg)].join(' ');
  return isWindows() ? `& ${command}` : command;
}

function mapResult(command: string, output: CommandOutput): FeishuCommandRawResult {
  return scrubFeishuRawResult({
    command,
    stdout: output.stdout,
    stderr: output.stderr,
    code: output.code,
  });
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

function toRawResult(command: string, value: unknown): FeishuCommandRawResult {
  return scrubFeishuRawResult({
    command,
    stdout: typeof value === 'string' ? value : JSON.stringify(value),
    stderr: '',
    code: 0,
  });
}

function toErrorResult(command: string, error: unknown): FeishuCommandRawResult {
  return scrubFeishuRawResult({
    command,
    stdout: '',
    stderr: scrubFeishuText(error instanceof Error ? error.message : String(error)),
    code: -1,
  });
}

function generateOperationId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class LarkMcpAdapter implements FeishuConnectorAdapter {
  readonly kind = 'lark_mcp' as const;

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

  private async batchCreateRecordsInternal(input: FeishuCreateRecordsInput): Promise<FeishuCommandRawResult> {
    return await this.invokeMcpTool(input.appId, 'bitable.v1.appTableRecord.batchCreate', {
      path: {
        app_token: input.baseId,
        table_id: input.tableId,
      },
      data: {
        records: input.records.map((fields) => ({ fields })),
      },
      useUAT: true,
    });
  }

  private async batchUpdateRecordsInternal(
    appId: string | undefined,
    baseId: string,
    tableId: string,
    records: Array<{ recordId: string; fields: Record<string, unknown> }>,
  ): Promise<FeishuCommandRawResult> {
    return await this.invokeMcpTool(appId, 'bitable.v1.appTableRecord.batchUpdate', {
      path: {
        app_token: baseId,
        table_id: tableId,
      },
      data: {
        records: records.map((item) => ({
          record_id: item.recordId,
          fields: item.fields,
        })),
      },
      useUAT: true,
    });
  }

  private async listAllRecords(input: {
    appId?: string;
    baseId: string;
    tableId: string;
    filter?: Record<string, unknown>;
  }): Promise<Array<{ recordId: string; fields: Record<string, unknown> }>> {
    const records: Array<{ recordId: string; fields: Record<string, unknown> }> = [];
    let pageToken: string | undefined;

    do {
      const raw = await this.queryRecords({
        appId: input.appId,
        baseId: input.baseId,
        tableId: input.tableId,
        filter: input.filter,
        pageSize: 200,
        pageToken,
      });
      if (raw.code !== 0) {
        throw new Error(raw.stderr || raw.stdout || '飞书记录查询失败。');
      }

      const data = feishuResultNormalizer.unwrapData(feishuResultNormalizer.parseJsonPayload(raw.stdout));
      const pageItems = feishuResultNormalizer.extractItems(data)
        .map((item) => feishuResultNormalizer.normalizeRecordEnvelope(feishuResultNormalizer.asObject(item)))
        .filter((item): item is { recordId: string; fields: Record<string, unknown> } => typeof item.recordId === 'string' && !!item.recordId);
      records.push(...pageItems);
      pageToken = feishuResultNormalizer.pickString(data, ['page_token', 'pageToken', 'next_page_token']);
      if (!(feishuResultNormalizer.pickBoolean(data, ['has_more', 'hasMore']) ?? false)) {
        pageToken = undefined;
      }
    } while (pageToken);

    return records;
  }

  private toFailedWriteResult(
    action: FeishuWriteAction,
    baseId: string,
    tableId: string,
    totalCount: number,
    error: unknown,
  ): FeishuRecordWriteResult {
    const reason = error instanceof Error ? error.message : String(error);
    return buildWriteResult({
      success: false,
      action,
      baseId,
      tableId,
      successCount: 0,
      failureCount: totalCount,
      createdCount: action === 'create' ? 0 : undefined,
      updatedCount: action === 'create' ? undefined : 0,
      matchedCount: action === 'update_by_filter' ? totalCount : undefined,
      failures: totalCount > 0 ? [{ index: 0, reason }] : [],
      message: reason,
    });
  }

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

  private async invokeMcpTool(appId: string | undefined, toolName: string, args: Record<string, unknown>): Promise<FeishuCommandRawResult> {
    const serverName = await this.ensureMcpServer(appId);
    const command = `${serverName}:${toolName}`;
    try {
      const result = await mcpManager.callTool(serverName, toolName, args);
      return toRawResult(command, result);
    } catch (error) {
      return toErrorResult(command, error);
    }
  }

  async checkNodeVersion(): Promise<FeishuCommandRawResult> {
    return await runArgvCommand(buildArgvCommand('node', ['--version']), 20);
  }

  async checkNpxVersion(): Promise<FeishuCommandRawResult> {
    return await runArgvCommand(buildArgvCommand('npx', ['--version']), 20);
  }

  async checkCliVersion(): Promise<FeishuCommandRawResult> {
    const attempts: string[][] = [
      ['-y', '@larksuiteoapi/lark-mcp', '--version'],
      ['-y', '@larksuiteoapi/lark-mcp', '-V'],
    ];

    let lastError: FeishuCommandRawResult | null = null;
    for (const args of attempts) {
      try {
        return await runArgvCommand(buildArgvCommand('npx', args), 90);
      } catch (error) {
        lastError = {
          command: `npx ${args.join(' ')}`,
          stdout: '',
          stderr: scrubFeishuText(error instanceof Error ? error.message : String(error)),
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

  async installCli(): Promise<FeishuCommandRawResult> {
    return {
      command: 'npx -y @larksuite/cli@latest install',
      stdout: '',
      stderr: 'LarkMcpAdapter 不负责安装 lark-cli。',
      code: -1,
    };
  }

  async initializeConfig(): Promise<FeishuCommandRawResult> {
    return {
      command: 'noop',
      stdout: 'LarkMcpAdapter 无需单独初始化 lark-cli config。',
      stderr: '',
      code: 0,
    };
  }

  async startLogin(
    input: FeishuLoginStartInput,
    onOutput?: (line: string, stream: 'stdout' | 'stderr') => void,
  ): Promise<FeishuConnectorLoginHandle> {
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

  async getAuthStatus(_appId?: string): Promise<FeishuCommandRawResult> {
    return {
      command: 'npx -y @larksuiteoapi/lark-mcp auth status',
      stdout: '',
      stderr: 'LarkMcpAdapter 不提供 lark-cli auth status。',
      code: -1,
    };
  }

  async logout(appId?: string): Promise<FeishuCommandRawResult> {
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
    return await runArgvCommand(buildArgvCommand('npx', args), 60);
  }

  async listBases(input?: FeishuListBasesInput): Promise<FeishuCommandRawResult> {
    return await this.invokeMcpTool(input?.appId, 'drive.v1.file.list', {
      params: {
        folder_token: input?.folderToken,
        page_size: input?.pageSize,
        page_token: input?.pageToken,
      },
      useUAT: true,
    });
  }

  async listTables(input: FeishuListTablesInput): Promise<FeishuCommandRawResult> {
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

  async getTableSchema(input: FeishuGetTableSchemaInput): Promise<FeishuCommandRawResult> {
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

  async queryRecords(input: FeishuQueryRecordsInput): Promise<FeishuCommandRawResult> {
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
    if (_input.records.length === 0) {
      return buildWriteResult({
        success: true,
        action: 'create',
        baseId: _input.baseId,
        tableId: _input.tableId,
        successCount: 0,
        failureCount: 0,
        createdCount: 0,
        message: '没有需要新增的记录。',
      });
    }

    try {
      const raw = await this.batchCreateRecordsInternal(_input);
      if (raw.code !== 0) {
        throw new Error(raw.stderr || raw.stdout || '飞书新增记录失败。');
      }

      const payload = feishuResultNormalizer.parseJsonPayload(raw.stdout);
      const createdCount = feishuResultNormalizer.extractWriteSuccessCount(payload, _input.records.length);
      const failureCount = Math.max(0, _input.records.length - createdCount);
      return buildWriteResult({
        success: failureCount === 0,
        action: 'create',
        baseId: _input.baseId,
        tableId: _input.tableId,
        successCount: createdCount,
        failureCount,
        createdCount,
        failures: failureCount > 0 ? [{ index: createdCount, reason: '部分记录未成功创建。' }] : [],
        message: failureCount === 0
          ? `已成功新增 ${createdCount} 条记录。`
          : `已新增 ${createdCount} 条记录，另有 ${failureCount} 条失败。`,
      });
    } catch (error) {
      return this.toFailedWriteResult('create', _input.baseId, _input.tableId, _input.records.length, error);
    }
  }

  async upsertRecords(input: FeishuUpsertRecordsInput): Promise<FeishuRecordWriteResult> {
    if (input.records.length === 0) {
      return buildWriteResult({
        success: true,
        action: 'upsert',
        baseId: input.baseId,
        tableId: input.tableId,
        successCount: 0,
        failureCount: 0,
        createdCount: 0,
        updatedCount: 0,
        matchedCount: 0,
        message: '没有需要 upsert 的记录。',
      });
    }

    try {
      const existingRecords = await this.listAllRecords(input);
      const existingByKey = new Map<string, string>();
      for (const existing of existingRecords) {
        const key = makeMatchKey(existing.fields, input.matchByFields);
        if (key && existing.recordId && !existingByKey.has(key)) {
          existingByKey.set(key, existing.recordId);
        }
      }

      const toCreate: Array<Record<string, unknown>> = [];
      const toUpdate: Array<{ recordId: string; fields: Record<string, unknown> }> = [];
      const failures: Array<{ index: number; reason: string }> = [];

      input.records.forEach((record, index) => {
        const key = makeMatchKey(record, input.matchByFields);
        if (!key) {
          failures.push({
            index,
            reason: `第 ${index + 1} 条记录缺少 upsert 匹配字段 ${input.matchByFields.join(', ')}。`,
          });
          return;
        }

        const recordId = existingByKey.get(key);
        if (recordId) {
          toUpdate.push({ recordId, fields: record });
          return;
        }

        toCreate.push(record);
      });

      let createdCount = 0;
      let updatedCount = 0;

      if (toCreate.length > 0) {
        const createResult = await this.createRecords({
          appId: input.appId,
          baseId: input.baseId,
          tableId: input.tableId,
          records: toCreate,
        });
        createdCount = createResult.createdCount ?? createResult.successCount;
        failures.push(...createResult.failures);
      }

      if (toUpdate.length > 0) {
        const raw = await this.batchUpdateRecordsInternal(input.appId, input.baseId, input.tableId, toUpdate);
        if (raw.code !== 0) {
          throw new Error(raw.stderr || raw.stdout || '飞书批量更新记录失败。');
        }
        updatedCount = feishuResultNormalizer.extractWriteSuccessCount(
          feishuResultNormalizer.parseJsonPayload(raw.stdout),
          toUpdate.length,
        );
      }

      const successCount = createdCount + updatedCount;
      const failureCount = Math.max(0, input.records.length - successCount);
      return buildWriteResult({
        success: failureCount === 0,
        action: 'upsert',
        baseId: input.baseId,
        tableId: input.tableId,
        successCount,
        failureCount,
        createdCount,
        updatedCount,
        matchedCount: toUpdate.length,
        failures,
        message: failureCount === 0
          ? `upsert 完成：新增 ${createdCount} 条，更新 ${updatedCount} 条。`
          : `upsert 完成：新增 ${createdCount} 条，更新 ${updatedCount} 条，失败 ${failureCount} 条。`,
      });
    } catch (error) {
      return this.toFailedWriteResult('upsert', input.baseId, input.tableId, input.records.length, error);
    }
  }

  async updateRecordsByFilter(input: FeishuUpdateRecordsByFilterInput): Promise<FeishuRecordWriteResult> {
    try {
      const matchedRecords = await this.listAllRecords(input);
      if (matchedRecords.length === 0) {
        return buildWriteResult({
          success: true,
          action: 'update_by_filter',
          baseId: input.baseId,
          tableId: input.tableId,
          successCount: 0,
          failureCount: 0,
          updatedCount: 0,
          matchedCount: 0,
          message: '未匹配到需要更新的记录。',
        });
      }

      const raw = await this.batchUpdateRecordsInternal(
        input.appId,
        input.baseId,
        input.tableId,
        matchedRecords.map((item) => ({
          recordId: item.recordId,
          fields: input.fields,
        })),
      );
      if (raw.code !== 0) {
        throw new Error(raw.stderr || raw.stdout || '飞书按条件更新记录失败。');
      }

      const updatedCount = feishuResultNormalizer.extractWriteSuccessCount(
        feishuResultNormalizer.parseJsonPayload(raw.stdout),
        matchedRecords.length,
      );
      const failureCount = Math.max(0, matchedRecords.length - updatedCount);
      return buildWriteResult({
        success: failureCount === 0,
        action: 'update_by_filter',
        baseId: input.baseId,
        tableId: input.tableId,
        successCount: updatedCount,
        failureCount,
        updatedCount,
        matchedCount: matchedRecords.length,
        failures: failureCount > 0 ? [{ index: updatedCount, reason: '部分命中记录未成功更新。' }] : [],
        message: failureCount === 0
          ? `已按条件更新 ${updatedCount} 条记录。`
          : `命中 ${matchedRecords.length} 条记录，成功更新 ${updatedCount} 条，失败 ${failureCount} 条。`,
      });
    } catch (error) {
      return this.toFailedWriteResult('update_by_filter', input.baseId, input.tableId, 1, error);
    }
  }
}

export const larkMcpAdapter = new LarkMcpAdapter();
