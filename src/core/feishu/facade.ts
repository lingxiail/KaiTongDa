import type {
  FeishuConnectInput,
  FeishuConnectionStatus,
  FeishuFieldSchema,
  FeishuGetTableSchemaInput,
  FeishuListBasesInput,
  FeishuListTablesInput,
  FeishuPagedResult,
  FeishuQueryRecordsInput,
  FeishuRecordQueryResult,
  FeishuBaseSummary,
  FeishuTableSummary,
} from './types';
import { FeishuAuthService, feishuAuthService } from './authService';
import { FeishuBaseService, feishuBaseService } from './baseService';

export class FeishuFacade {
  constructor(
    private readonly authService: FeishuAuthService = feishuAuthService,
    private readonly baseService: FeishuBaseService = feishuBaseService,
  ) {}

  async connect(input: FeishuConnectInput = {}): Promise<FeishuConnectionStatus> {
    return await this.authService.startLogin(input);
  }

  async getAuthStatus(input?: Pick<FeishuConnectInput, 'appId' | 'domain'>): Promise<FeishuConnectionStatus> {
    return await this.authService.pollLoginStatus(input);
  }

  async disconnect(input?: Pick<FeishuConnectInput, 'appId' | 'domain'>): Promise<FeishuConnectionStatus> {
    return await this.authService.disconnect(input);
  }

  async listBases(input?: FeishuListBasesInput): Promise<FeishuPagedResult<FeishuBaseSummary>> {
    return await this.baseService.listBases(input);
  }

  async listTables(input: FeishuListTablesInput): Promise<FeishuPagedResult<FeishuTableSummary>> {
    return await this.baseService.listTables(input);
  }

  async getTableSchema(input: FeishuGetTableSchemaInput): Promise<FeishuPagedResult<FeishuFieldSchema>> {
    return await this.baseService.getTableSchema(input);
  }

  async queryRecords(input: FeishuQueryRecordsInput): Promise<FeishuRecordQueryResult> {
    return await this.baseService.queryRecords(input);
  }
}

export const feishuFacade = new FeishuFacade();
