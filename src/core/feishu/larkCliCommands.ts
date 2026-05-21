import { buildArgvCommand, type ArgvCommand } from './argvExecutor';
import type {
  FeishuCreateRecordsInput,
  FeishuGetTableSchemaInput,
  FeishuListBasesInput,
  FeishuListTablesInput,
  FeishuLoginStartInput,
  FeishuQueryRecordsInput,
  FeishuUpdateRecordsByFilterInput,
  FeishuUpsertRecordsInput,
} from './types';

function pushOptionalArg(args: string[], flag: string, value: string | number | undefined): void {
  if (value === undefined || value === null || value === '') {
    return;
  }
  args.push(flag, String(value));
}

function pushOptionalJsonArg(args: string[], flag: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  args.push(flag, JSON.stringify(value));
}

function pushOptionalStringListArg(args: string[], flag: string, values: string[] | undefined): void {
  if (!values || values.length === 0) {
    return;
  }
  args.push(flag, values.join(','));
}

function buildLarkCliCommand(args: string[]): ArgvCommand {
  return buildArgvCommand('lark-cli', args);
}

export function buildNodeVersionCommand(): ArgvCommand {
  return buildArgvCommand('node', ['--version']);
}

export function buildNpxVersionCommand(): ArgvCommand {
  return buildArgvCommand('npx', ['--version']);
}

export function buildCliVersionCommand(): ArgvCommand {
  return buildLarkCliCommand(['--version']);
}

export function buildCliInstallCommand(): ArgvCommand {
  return buildArgvCommand('npx', ['-y', '@larksuite/cli@latest', 'install']);
}

export function buildConfigInitCommand(): ArgvCommand {
  return buildLarkCliCommand(['config', 'init', '--new']);
}

export function buildAuthLoginCommand(input: FeishuLoginStartInput): ArgvCommand {
  const args = ['auth', 'login', '--recommend'];
  if (input.noWait) {
    args.push('--no-wait');
  }
  if (input.json) {
    args.push('--json');
  }
  pushOptionalArg(args, '--domain', input.domain);
  pushOptionalArg(args, '--port', input.port);
  if (input.preferredScopes && input.preferredScopes.length > 0) {
    args.push('--scope', ...input.preferredScopes);
  }
  return buildLarkCliCommand(args);
}

export function buildAuthStatusCommand(): ArgvCommand {
  return buildLarkCliCommand(['auth', 'status']);
}

export function buildLogoutCommand(): ArgvCommand {
  return buildLarkCliCommand(['auth', 'logout']);
}

export function buildListBasesCommand(input: FeishuListBasesInput = {}): ArgvCommand {
  const args = ['base', 'list', '--format', 'json'];
  pushOptionalArg(args, '--folder-token', input.folderToken);
  pushOptionalArg(args, '--page-size', input.pageSize);
  pushOptionalArg(args, '--page-token', input.pageToken);
  return buildLarkCliCommand(args);
}

export function buildListTablesCommand(input: FeishuListTablesInput): ArgvCommand {
  const args = ['base', 'table', 'list', '--base-id', input.baseId, '--format', 'json'];
  pushOptionalArg(args, '--page-size', input.pageSize);
  pushOptionalArg(args, '--page-token', input.pageToken);
  return buildLarkCliCommand(args);
}

export function buildGetTableSchemaCommand(input: FeishuGetTableSchemaInput): ArgvCommand {
  const args = ['base', 'field', 'list', '--base-id', input.baseId, '--table-id', input.tableId, '--format', 'json'];
  pushOptionalArg(args, '--page-size', input.pageSize);
  pushOptionalArg(args, '--page-token', input.pageToken);
  return buildLarkCliCommand(args);
}

export function buildQueryRecordsCommand(input: FeishuQueryRecordsInput): ArgvCommand {
  const args = ['base', 'record', 'search', '--base-id', input.baseId, '--table-id', input.tableId, '--format', 'json'];
  pushOptionalJsonArg(args, '--filter-json', input.filter);
  pushOptionalJsonArg(args, '--sort-json', input.sort);
  pushOptionalArg(args, '--view-id', input.viewId);
  pushOptionalStringListArg(args, '--field-names', input.fieldNames);
  pushOptionalArg(args, '--page-size', input.pageSize);
  pushOptionalArg(args, '--page-token', input.pageToken);
  return buildLarkCliCommand(args);
}

export function buildCreateRecordsCommand(input: FeishuCreateRecordsInput): ArgvCommand {
  return buildLarkCliCommand([
    'base',
    'record',
    'create',
    '--base-id',
    input.baseId,
    '--table-id',
    input.tableId,
    '--format',
    'json',
    '--records-json',
    JSON.stringify(input.records),
  ]);
}

export function buildUpsertRecordsCommand(input: FeishuUpsertRecordsInput): ArgvCommand {
  return buildLarkCliCommand([
    'base',
    'record',
    'upsert',
    '--base-id',
    input.baseId,
    '--table-id',
    input.tableId,
    '--format',
    'json',
    '--match-by-fields',
    input.matchByFields.join(','),
    '--records-json',
    JSON.stringify(input.records),
  ]);
}

export function buildUpdateRecordsCommand(input: FeishuUpdateRecordsByFilterInput): ArgvCommand {
  return buildLarkCliCommand([
    'base',
    'record',
    'update',
    '--base-id',
    input.baseId,
    '--table-id',
    input.tableId,
    '--format',
    'json',
    '--filter-json',
    JSON.stringify(input.filter),
    '--fields-json',
    JSON.stringify(input.fields),
  ]);
}
