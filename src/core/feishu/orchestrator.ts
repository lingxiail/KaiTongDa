import { FeishuAuthService, feishuAuthService } from './authService';
import { FeishuBaseService, feishuBaseService } from './baseService';
import { buildAmbiguousBaseQuestion, buildAmbiguousTableQuestion, buildMissingBaseQuestion, buildMissingTableQuestion, buildNeedConnectMessage, buildNeedCredentialsMessage, buildUnknownIntentMessage } from './messages';
import { FeishuResourceResolver } from './resourceResolver';
import { FeishuSessionStore, feishuSessionStore } from './sessionStore';
import { FeishuToolMapper, feishuToolMapper } from './toolMapper';
import { TOOL_NAMES } from '../tools/toolNames';
import type { FeishuHandleRequestInput, FeishuHandleRequestResult, FeishuIntent, FeishuIntentContext } from './intentTypes';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toConversationContext(input?: Record<string, unknown>): Partial<{
  baseId: string;
  baseName: string;
  tableId: string;
  tableName: string;
}> {
  const context = {
    baseId: asString(input?.baseId),
    baseName: asString(input?.baseName),
    tableId: asString(input?.tableId),
    tableName: asString(input?.tableName),
  };
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  ) as Partial<{
    baseId: string;
    baseName: string;
    tableId: string;
    tableName: string;
  }>;
}

export class FeishuIntentOrchestrator {
  private readonly authService: FeishuAuthService;
  private readonly store: FeishuSessionStore;
  private readonly mapper: FeishuToolMapper;
  private readonly resolver: FeishuResourceResolver;

  constructor(
    authService: FeishuAuthService = feishuAuthService,
    baseService: FeishuBaseService = feishuBaseService,
    store: FeishuSessionStore = feishuSessionStore,
    mapper: FeishuToolMapper = feishuToolMapper,
    resolver: FeishuResourceResolver = new FeishuResourceResolver(baseService, store),
  ) {
    this.authService = authService;
    this.store = store;
    this.mapper = mapper;
    this.resolver = resolver;
  }

  private buildResult(input: {
    handleInput: FeishuHandleRequestInput;
    context: FeishuIntentContext;
    message: string;
    needClarification?: boolean;
    clarificationQuestion?: string;
    result?: unknown;
  }): FeishuHandleRequestResult {
    const intent = this.mapper.mapIntent(input.handleInput.query, input.context);
    return {
      intent,
      resolvedContext: input.context,
      needClarification: input.needClarification ?? false,
      clarificationQuestion: input.clarificationQuestion,
      executionPlan: this.mapper.buildExecutionPlan(intent, input.context),
      result: input.result,
      message: input.message,
    };
  }

  private rememberResolvedContext(appId: string | undefined, intent: FeishuIntent, context: FeishuIntentContext): void {
    if (!context.base && !context.table && !context.fieldSchemas?.length) {
      return;
    }

    this.store.mergeRecentContext(appId, {
      appId,
      baseId: context.base?.id,
      baseName: context.base?.name,
      tableId: context.table?.id,
      tableName: context.table?.name,
      fieldNames: context.fieldSchemas?.map((item) => item.fieldName),
      intent: intent.kind,
    });
  }

  private getPrimaryPlannedTool(intent: FeishuIntent, context: FeishuIntentContext): string | undefined {
    return this.mapper
      .buildExecutionPlan(intent, context)
      .steps
      .find((step) => step.toolName !== TOOL_NAMES.FEISHU_AUTH_STATUS)
      ?.toolName;
  }

  private buildRoutingMessage(intent: FeishuIntent, context: FeishuIntentContext): string {
    const toolName = this.getPrimaryPlannedTool(intent, context);
    const baseName = context.base?.name || context.recentContext?.baseName;
    const tableName = context.table?.name || context.recentContext?.tableName;

    if (toolName === TOOL_NAMES.FEISHU_LIST_BASES) {
      return '已识别为列出飞书 Base 的请求。请继续调用 feishu_list_bases；自然语言入口当前只做轻量识别与上下文补全。';
    }
    if (toolName === TOOL_NAMES.FEISHU_LIST_TABLES) {
      return baseName
        ? `已识别为列出 Base「${baseName}」下数据表的请求。请继续调用 feishu_list_tables。`
        : '已识别为列出数据表的请求。请继续调用 feishu_list_tables。';
    }
    if (toolName === TOOL_NAMES.FEISHU_GET_TABLE_SCHEMA) {
      return tableName
        ? `已识别为读取表「${tableName}」字段结构的请求。请继续调用 feishu_get_table_schema。`
        : '已识别为读取字段结构的请求。请继续调用 feishu_get_table_schema。';
    }
    if (toolName === TOOL_NAMES.FEISHU_QUERY_RECORDS) {
      return tableName
        ? `已识别为查询表「${tableName}」记录的请求。请继续调用 feishu_query_records。`
        : '已识别为查询记录的请求。请继续调用 feishu_query_records。';
    }
    if (toolName === TOOL_NAMES.FEISHU_CREATE_RECORDS) {
      return '已识别为新增记录意图。自然语言入口当前只做规划，不直接执行写入；请继续调用 feishu_create_records。';
    }
    if (toolName === TOOL_NAMES.FEISHU_UPSERT_RECORDS) {
      return '已识别为 upsert 记录意图。自然语言入口当前只做规划，不直接执行写入；请继续调用 feishu_upsert_records。';
    }
    if (toolName === TOOL_NAMES.FEISHU_UPDATE_RECORDS_BY_FILTER) {
      return '已识别为按筛选条件更新记录的意图。自然语言入口当前只做规划，不直接执行写入；请继续调用 feishu_update_records_by_filter。';
    }
    if (intent.kind === 'write_request') {
      return '已识别为飞书写入请求，但还不能稳定判断应该走新增、upsert 还是按筛选更新。请补充明确动作，或直接调用对应结构化写入工具。';
    }
    return '已识别出飞书请求。请继续调用对应结构化飞书工具。';
  }

  private async ensureConnected(input: FeishuHandleRequestInput, context: FeishuIntentContext): Promise<FeishuHandleRequestResult | null> {
    const authStatus = await this.authService.checkAuthStatus({ appId: input.appId, domain: input.domain });
    context.authStatus = authStatus;
    if (authStatus.connected) {
      return null;
    }

    const runtimeConfig = this.store.getRuntimeConfig(input.appId);
    const appId = input.appId || runtimeConfig.appId;
    const appSecret = input.appSecret || runtimeConfig.appSecret;
    const domain = input.domain || runtimeConfig.domain;
    if (!appId || !appSecret) {
      return this.buildResult({
        handleInput: input,
        context,
        message: buildNeedConnectMessage(),
        needClarification: true,
        clarificationQuestion: buildNeedCredentialsMessage(),
      });
    }

    const connectResult = await this.authService.startLogin({
      appId,
      appSecret,
      domain,
    });
    context.appId = appId;
    context.authStatus = connectResult;
    if (!connectResult.connected) {
      return this.buildResult({
        handleInput: input,
        context,
        message: connectResult.message,
        result: connectResult,
      });
    }

    return null;
  }

  async handleRequest(input: FeishuHandleRequestInput): Promise<FeishuHandleRequestResult> {
    const appId = input.appId?.trim();
    const recentContext = this.store.getRecentContext(appId);
    const queryContext = toConversationContext(input.conversationContext);
    const intentContext: FeishuIntentContext = {
      appId,
      recentContext: recentContext
        ? { ...recentContext, ...queryContext }
        : queryContext.baseId || queryContext.baseName || queryContext.tableId || queryContext.tableName
          ? { ...queryContext, updatedAt: Date.now() }
          : null,
      missingSlots: [],
    };
    const intent = this.mapper.mapIntent(input.query, intentContext);

    if (intent.kind === 'unknown') {
      return {
        intent,
        resolvedContext: intentContext,
        needClarification: true,
        clarificationQuestion: buildUnknownIntentMessage(),
        executionPlan: this.mapper.buildExecutionPlan(intent, intentContext),
        message: buildUnknownIntentMessage(),
      };
    }

    if (intent.kind === 'connect') {
      const runtimeConfig = this.store.getRuntimeConfig(appId);
      const connectResult = await this.authService.startLogin({
        appId: input.appId || runtimeConfig.appId || '',
        appSecret: input.appSecret || runtimeConfig.appSecret || '',
        domain: input.domain || runtimeConfig.domain,
      });
      intentContext.appId = connectResult.appId || appId;
      intentContext.authStatus = connectResult;
      return {
        intent,
        resolvedContext: intentContext,
        needClarification: !connectResult.success && connectResult.message.includes('缺少飞书 App ID 或 App Secret'),
        clarificationQuestion: !connectResult.success && connectResult.message.includes('缺少飞书 App ID 或 App Secret')
          ? buildNeedCredentialsMessage()
          : undefined,
        executionPlan: this.mapper.buildExecutionPlan(intent, intentContext),
        result: connectResult,
        message: connectResult.message,
      };
    }

    if (intent.kind === 'auth_status') {
      const status = await this.authService.checkAuthStatus({ appId, domain: input.domain });
      intentContext.appId = status.appId || appId;
      intentContext.authStatus = status;
      return {
        intent,
        resolvedContext: intentContext,
        needClarification: false,
        executionPlan: this.mapper.buildExecutionPlan(intent, intentContext),
        result: status,
        message: status.message,
      };
    }

    const connectGate = await this.ensureConnected(input, intentContext);
    if (connectGate) {
      return connectGate;
    }

    if (intent.kind === 'list_bases') {
      return this.buildResult({
        handleInput: input,
        context: intentContext,
        message: this.buildRoutingMessage(intent, intentContext),
      });
    }

    if (intent.kind === 'list_tables') {
      const base = await this.resolver.resolveBase({
        appId: intentContext.appId,
        baseId: asString(input.conversationContext?.baseId) || asString(intent.slots.find((slot) => slot.name === 'baseId')?.value),
        baseName: asString(input.conversationContext?.baseName) || asString(intent.slots.find((slot) => slot.name === 'baseName')?.value),
      });
      if (base.candidates?.length) {
        intentContext.candidates = base.candidates;
        return {
          intent,
          resolvedContext: intentContext,
          needClarification: true,
          clarificationQuestion: buildAmbiguousBaseQuestion(base.candidates),
          executionPlan: this.mapper.buildExecutionPlan(intent, intentContext),
          message: buildAmbiguousBaseQuestion(base.candidates),
        };
      }
      if (!base.resolved) {
        return {
          intent,
          resolvedContext: intentContext,
          needClarification: true,
          clarificationQuestion: buildMissingBaseQuestion(),
          executionPlan: this.mapper.buildExecutionPlan(intent, intentContext),
          message: buildMissingBaseQuestion(),
        };
      }
      intentContext.base = base.resolved;
      this.rememberResolvedContext(intentContext.appId, intent, intentContext);
      return this.buildResult({
        handleInput: input,
        context: intentContext,
        message: this.buildRoutingMessage(intent, intentContext),
      });
    }

    const table = await this.resolver.resolveTable({
      appId: intentContext.appId,
      baseId: asString(input.conversationContext?.baseId) || asString(intent.slots.find((slot) => slot.name === 'baseId')?.value),
      baseName: asString(input.conversationContext?.baseName) || asString(intent.slots.find((slot) => slot.name === 'baseName')?.value),
      tableId: asString(input.conversationContext?.tableId) || asString(intent.slots.find((slot) => slot.name === 'tableId')?.value),
      tableName: asString(input.conversationContext?.tableName) || asString(intent.slots.find((slot) => slot.name === 'tableName')?.value),
    });

    if (table.candidates?.length) {
      intentContext.base = table.base;
      intentContext.candidates = table.candidates;
      return {
        intent,
        resolvedContext: intentContext,
        needClarification: true,
        clarificationQuestion: table.candidates[0].type === 'base'
          ? buildAmbiguousBaseQuestion(table.candidates)
          : buildAmbiguousTableQuestion(table.candidates),
        executionPlan: this.mapper.buildExecutionPlan(intent, intentContext),
        message: table.candidates[0].type === 'base'
          ? buildAmbiguousBaseQuestion(table.candidates)
          : buildAmbiguousTableQuestion(table.candidates),
      };
    }

    if (!table.base) {
      return {
        intent,
        resolvedContext: intentContext,
        needClarification: true,
        clarificationQuestion: buildMissingBaseQuestion(),
        executionPlan: this.mapper.buildExecutionPlan(intent, intentContext),
        message: buildMissingBaseQuestion(),
      };
    }
    intentContext.base = table.base;

    if (!table.resolved) {
      return {
        intent,
        resolvedContext: intentContext,
        needClarification: true,
        clarificationQuestion: buildMissingTableQuestion(table.base.name),
        executionPlan: this.mapper.buildExecutionPlan(intent, intentContext),
        message: buildMissingTableQuestion(table.base.name),
      };
    }

    intentContext.table = table.resolved;
    if (intent.kind === 'get_table_schema') {
      intentContext.fieldSchemas = await this.resolver.getFieldSchemas(
        intentContext.appId,
        table.base.id,
        table.resolved.id,
      );
    }
    this.rememberResolvedContext(intentContext.appId, intent, intentContext);

    if (intent.kind === 'write_request') {
      const plannedTool = this.getPrimaryPlannedTool(intent, intentContext);
      const needsClarification = !plannedTool || plannedTool === TOOL_NAMES.FEISHU_HANDLE_REQUEST;
      return this.buildResult({
        handleInput: input,
        context: intentContext,
        needClarification: needsClarification,
        clarificationQuestion: needsClarification
          ? '请补充明确的写入动作，例如“新增记录”“按匹配字段 upsert”或“按筛选条件更新”，并优先改用对应结构化写入工具。'
          : undefined,
        message: this.buildRoutingMessage(intent, intentContext),
      });
    }

    return this.buildResult({
      handleInput: input,
      context: intentContext,
      message: this.buildRoutingMessage(intent, intentContext),
    });
  }
}

export const feishuIntentOrchestrator = new FeishuIntentOrchestrator();
