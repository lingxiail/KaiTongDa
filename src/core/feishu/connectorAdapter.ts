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

export interface FeishuCommandRawResult {
  command: string;
  stdout: string;
  stderr: string;
  code: number;
}

export interface FeishuConnectorLoginHandle {
  id: string;
  command: string;
  completion: Promise<FeishuCommandRawResult>;
}

export type FeishuConnectorKind = 'lark_cli' | 'lark_mcp' | 'feishu_openapi';

export type FeishuConnectorCapability =
  | 'check_node_version'
  | 'check_cli_version'
  | 'start_login'
  | 'logout'
  | 'list_bases'
  | 'list_tables'
  | 'get_table_schema'
  | 'query_records'
  | 'create_records'
  | 'upsert_records'
  | 'update_records_by_filter';

export interface FeishuConnectorAdapter {
  readonly kind: FeishuConnectorKind;
  getCapabilities?(): FeishuConnectorCapability[];
  checkNodeVersion(): Promise<FeishuCommandRawResult>;
  checkCliVersion(): Promise<FeishuCommandRawResult>;
  startLogin(
    input: FeishuLoginStartInput,
    onOutput?: (line: string, stream: 'stdout' | 'stderr') => void,
  ): Promise<FeishuConnectorLoginHandle>;
  logout(appId?: string): Promise<FeishuCommandRawResult>;
  listBases(input?: FeishuListBasesInput): Promise<FeishuCommandRawResult>;
  listTables(input: FeishuListTablesInput): Promise<FeishuCommandRawResult>;
  getTableSchema(input: FeishuGetTableSchemaInput): Promise<FeishuCommandRawResult>;
  queryRecords(input: FeishuQueryRecordsInput): Promise<FeishuCommandRawResult>;
  createRecords(input: FeishuCreateRecordsInput): Promise<FeishuRecordWriteResult>;
  upsertRecords(input: FeishuUpsertRecordsInput): Promise<FeishuRecordWriteResult>;
  updateRecordsByFilter(input: FeishuUpdateRecordsByFilterInput): Promise<FeishuRecordWriteResult>;
}
