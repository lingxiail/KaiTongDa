import type {
  FeishuConnectInput,
  FeishuConnectionStatus,
  FeishuCreateRecordsInput,
  FeishuFieldSchema,
  FeishuGetTableSchemaInput,
  FeishuListBasesInput,
  FeishuListTablesInput,
  FeishuPagedResult,
  FeishuQueryRecordsInput,
  FeishuRecordQueryResult,
  FeishuRecordWriteResult,
  FeishuBaseSummary,
  FeishuTableSummary,
  FeishuUpdateRecordsByFilterInput,
  FeishuUpsertRecordsInput,
} from './types';
import type { FeishuHandleRequestInput, FeishuHandleRequestResult } from './intentTypes';
import { FeishuAuthService, feishuAuthService } from './authService';
import { FeishuBaseService, feishuBaseService } from './baseService';
import { FeishuIntentOrchestrator, feishuIntentOrchestrator } from './orchestrator';

export class FeishuFacade {
  private readonly authService: FeishuAuthService;
  private readonly baseService: FeishuBaseService;
  private readonly intentOrchestrator: FeishuIntentOrchestrator;

  constructor(
    authService: FeishuAuthService = feishuAuthService,
    baseService: FeishuBaseService = feishuBaseService,
    intentOrchestrator: FeishuIntentOrchestrator = feishuIntentOrchestrator,
  ) {
    this.authService = authService;
    this.baseService = baseService;
    this.intentOrchestrator = intentOrchestrator;
  }

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

  async createRecords(input: FeishuCreateRecordsInput): Promise<FeishuRecordWriteResult> {
    return await this.baseService.createRecords(input);
  }

  async upsertRecords(input: FeishuUpsertRecordsInput): Promise<FeishuRecordWriteResult> {
    return await this.baseService.upsertRecords(input);
  }

  async updateRecordsByFilter(input: FeishuUpdateRecordsByFilterInput): Promise<FeishuRecordWriteResult> {
    return await this.baseService.updateRecordsByFilter(input);
  }

  async handleRequest(input: FeishuHandleRequestInput): Promise<FeishuHandleRequestResult> {
    return await this.intentOrchestrator.handleRequest(input);
  }
}

export const feishuFacade = new FeishuFacade();
