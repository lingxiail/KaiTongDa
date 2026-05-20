import { FeishuAuthService, feishuAuthService } from './authService';
import { FeishuBaseService, feishuBaseService } from './baseService';
import { buildAmbiguousBaseQuestion, buildAmbiguousTableQuestion, buildMissingBaseQuestion, buildMissingTableQuestion, buildNeedConnectMessage, buildNeedCredentialsMessage, buildUnknownIntentMessage, buildUnsupportedWriteMessage } from './messages';
import { FeishuResourceResolver, feishuResourceResolver } from './resourceResolver';
import { FeishuSessionStore, feishuSessionStore } from './sessionStore';
import { FeishuToolMapper, feishuToolMapper } from './toolMapper';
import type { FeishuHandleRequestInput, FeishuHandleRequestResult, FeishuIntentContext } from './intentTypes';

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
  private readonly baseService: FeishuBaseService;
  private readonly store: FeishuSessionStore;
  private readonly mapper: FeishuToolMapper;
  private readonly resolver: FeishuResourceResolver;

  constructor(
    authService: FeishuAuthService = feishuAuthService,
    baseService: FeishuBaseService = feishuBaseService,
    store: FeishuSessionStore = feishuSessionStore,
    mapper: FeishuToolMapper = feishuToolMapper,
    resolver: FeishuResourceResolver = feishuResourceResolver,
  ) {
    this.authService = authService;
    this.baseService = baseService;
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

    if (intent.kind === 'write_request') {
      return {
        intent,
        resolvedContext: intentContext,
        needClarification: false,
        executionPlan: this.mapper.buildExecutionPlan(intent, intentContext),
        message: buildUnsupportedWriteMessage(),
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
      const result = await this.baseService.listBases({ appId: intentContext.appId, refresh: true });
      return {
        intent,
        resolvedContext: intentContext,
        needClarification: false,
        executionPlan: this.mapper.buildExecutionPlan(intent, intentContext),
        result,
        message: result.items.length > 0
          ? `已找到 ${result.items.length} 个 Base。`
          : '当前没有在飞书云空间根目录查到多维表格。这个入口底层使用 Drive 文件夹清单接口，只覆盖根目录或指定文件夹，不代表账号下所有可读/共享 Base；如果你知道 Base 链接或 app_token，可以直接让我列出该 Base 下的数据表。',
      };
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
      const result = await this.baseService.listTables({ appId: intentContext.appId, baseId: base.resolved.id });
      this.store.mergeRecentContext(intentContext.appId, {
        appId: intentContext.appId,
        baseId: base.resolved.id,
        baseName: base.resolved.name,
        intent: intent.kind,
      });
      return {
        intent,
        resolvedContext: intentContext,
        needClarification: false,
        executionPlan: this.mapper.buildExecutionPlan(intent, intentContext),
        result,
        message: `已找到 Base「${base.resolved.name}」下的 ${result.items.length} 张表。`,
      };
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
    this.store.mergeRecentContext(intentContext.appId, {
      appId: intentContext.appId,
      baseId: table.base.id,
      baseName: table.base.name,
      tableId: table.resolved.id,
      tableName: table.resolved.name,
      intent: intent.kind,
    });

    if (intent.kind === 'get_table_schema') {
      const result = await this.baseService.getTableSchema({
        appId: intentContext.appId,
        baseId: table.base.id,
        tableId: table.resolved.id,
      });
      intentContext.fieldSchemas = result.items;
      return {
        intent,
        resolvedContext: intentContext,
        needClarification: false,
        executionPlan: this.mapper.buildExecutionPlan(intent, intentContext),
        result,
        message: `已读取表「${table.resolved.name}」的字段结构。`,
      };
    }

    const limit = intent.slots.find((slot) => slot.name === 'limit')?.value;
    const result = await this.baseService.queryRecords({
      appId: intentContext.appId,
      baseId: table.base.id,
      tableId: table.resolved.id,
      pageSize: typeof limit === 'number' ? limit : 10,
    });
    return {
      intent,
      resolvedContext: intentContext,
      needClarification: false,
      executionPlan: this.mapper.buildExecutionPlan(intent, intentContext),
      result,
      message: `已查询表「${table.resolved.name}」的记录，共返回 ${result.records.length} 条。`,
    };
  }
}

export const feishuIntentOrchestrator = new FeishuIntentOrchestrator();
