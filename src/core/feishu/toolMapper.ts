import { TOOL_NAMES } from '../tools/toolNames';
import type { FeishuExecutionPlan, FeishuExecutionStep, FeishuIntent, FeishuIntentContext, FeishuIntentKind, FeishuIntentSlot } from './intentTypes';

function extractNumber(query: string): number | undefined {
  const matched = query.match(/(?:最近|最新|前|last|recent)?\s*(\d+)\s*条?(?:记录)?/i);
  if (!matched) return undefined;
  const value = Number(matched[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function extractBaseId(query: string): string | undefined {
  return query.match(/\b(app_[a-z0-9_-]+)\b/i)?.[1];
}

function extractTableId(query: string): string | undefined {
  return query.match(/\b(tbl_[a-z0-9_-]+)\b/i)?.[1];
}

function extractQuotedName(query: string): string | undefined {
  return query.match(/[“"'']([^“"'']+)[”"'']/)?.[1]?.trim();
}

function cleanupResourceName(value?: string): string | undefined {
  const trimmed = value
    ?.replace(/^(飞书|多维表格|多维表|base)\s*/i, '')
    .replace(/\s*(字段|schema|结构|记录|数据表|表)$/i, '')
    .trim();
  return trimmed || undefined;
}

function extractBaseName(query: string): string | undefined {
  const quoted = extractQuotedName(query);
  if (quoted && /base|多维表/i.test(query)) {
    return cleanupResourceName(quoted);
  }

  const matched = query.match(/(?:列出|查看|显示|打开).*(.+?)(?:下|里面|里的|中|内)的?(?:所有)?(?:表|数据表)/i);
  if (matched?.[1]) {
    return cleanupResourceName(matched[1]);
  }

  return query.match(/\bbase\s+([a-z0-9_-]+)/i)?.[1]?.trim();
}

function extractTableName(query: string): string | undefined {
  const quoted = extractQuotedName(query);
  if (quoted && /表|字段|schema|记录/i.test(query)) {
    return cleanupResourceName(quoted);
  }

  const schemaMatch = query.match(/(?:查看|列出|显示|读取)\s*([^，。]+?)(?:的)?(?:字段|schema|结构)/i);
  if (schemaMatch?.[1]) {
    return cleanupResourceName(schemaMatch[1]);
  }

  const recordsMatch = query.match(/(?:查询|查看|列出|显示|帮我查|帮我看)\s*([^，。]+?)\s*(?:最近|最新|前\s*\d+\s*条?)(?:记录)?/i);
  if (recordsMatch?.[1]) {
    return cleanupResourceName(recordsMatch[1]);
  }

  return query.match(/([\u4e00-\u9fa5A-Za-z0-9_-]+表)/)?.[1]?.trim();
}

function detectIntentKind(query: string): FeishuIntentKind {
  if (/(写入|新增|创建记录|更新记录|upsert|create|update)/i.test(query)) {
    return 'write_request';
  }
  if (/(连接|登录|授权).*(飞书|多维表)|^(连接飞书|登录飞书|授权飞书)$/i.test(query)) {
    return 'connect';
  }
  if (/(状态|连接情况|授权情况|是否已连接)/i.test(query)) {
    return 'auth_status';
  }
  if (/(字段|schema|结构)/i.test(query)) {
    return 'get_table_schema';
  }
  if (/(记录|最近|最新).*(记录)?/i.test(query)) {
    return 'query_records';
  }
  if (/(下的表|数据表列表|列出.*表|查看.*表)/i.test(query)) {
    return 'list_tables';
  }
  if (/(base|多维表格|多维表)/i.test(query)) {
    return 'list_bases';
  }
  return 'unknown';
}

function pushSlot(slots: FeishuIntentSlot[], name: FeishuIntentSlot['name'], value: unknown, source: FeishuIntentSlot['source']): void {
  if (value === undefined || value === null || value === '') return;
  slots.push({ name, value, source });
}

export class FeishuToolMapper {
  mapIntent(query: string, context?: Partial<FeishuIntentContext>): FeishuIntent {
    const kind = detectIntentKind(query);
    const slots: FeishuIntentSlot[] = [];
    const baseId = extractBaseId(query) || context?.recentContext?.baseId;
    const tableId = extractTableId(query) || context?.recentContext?.tableId;
    const baseName = extractBaseName(query) || context?.recentContext?.baseName;
    const tableName = extractTableName(query) || context?.recentContext?.tableName;
    const limit = extractNumber(query);

    pushSlot(slots, 'baseId', extractBaseId(query), 'query');
    pushSlot(slots, 'tableId', extractTableId(query), 'query');
    pushSlot(slots, 'baseName', extractBaseName(query), 'query');
    pushSlot(slots, 'tableName', extractTableName(query), 'query');
    pushSlot(slots, 'limit', limit, 'query');
    pushSlot(slots, 'baseId', context?.recentContext?.baseId, 'cache');
    pushSlot(slots, 'tableId', context?.recentContext?.tableId, 'cache');

    const missingSlots: string[] = [];
    if (kind === 'list_tables' && !baseId && !baseName) {
      missingSlots.push('base');
    }
    if ((kind === 'get_table_schema' || kind === 'query_records') && !tableId && !tableName) {
      missingSlots.push('table');
    }

    return {
      kind,
      confidence: kind === 'unknown' ? 'low' : kind === 'write_request' ? 'medium' : 'high',
      query,
      slots,
      missingSlots,
    };
  }

  buildExecutionPlan(intent: FeishuIntent, context: FeishuIntentContext): FeishuExecutionPlan {
    const steps: FeishuExecutionStep[] = [];

    if (intent.kind !== 'connect' && intent.kind !== 'auth_status') {
      steps.push({
        type: 'check_auth' as const,
        toolName: TOOL_NAMES.FEISHU_AUTH_STATUS,
        input: { appId: context.appId },
        reason: '先确认当前飞书连接状态。',
        status: 'completed' as const,
      });
    }

    if (intent.kind === 'connect') {
      steps.push({
        type: 'connect' as const,
        toolName: TOOL_NAMES.FEISHU_CONNECT,
        input: { appId: context.appId },
        reason: '发起飞书授权连接。',
        status: 'completed' as const,
      });
    } else if (intent.kind === 'auth_status') {
      steps.push({
        type: 'check_auth' as const,
        toolName: TOOL_NAMES.FEISHU_AUTH_STATUS,
        input: { appId: context.appId },
        reason: '返回当前授权状态。',
        status: 'completed' as const,
      });
    } else if (intent.kind === 'list_bases') {
      steps.push({
        type: 'list_bases' as const,
        toolName: TOOL_NAMES.FEISHU_LIST_BASES,
        input: { appId: context.appId },
        reason: '列出当前账号可访问的 Base。',
        status: 'completed' as const,
      });
    } else if (intent.kind === 'list_tables') {
      steps.push({
        type: 'list_tables' as const,
        toolName: TOOL_NAMES.FEISHU_LIST_TABLES,
        input: { appId: context.appId, baseId: context.base?.id },
        reason: '列出目标 Base 下的数据表。',
        status: context.base ? 'completed' : 'pending',
      });
    } else if (intent.kind === 'get_table_schema') {
      steps.push({
        type: 'get_table_schema' as const,
        toolName: TOOL_NAMES.FEISHU_GET_TABLE_SCHEMA,
        input: { appId: context.appId, baseId: context.base?.id, tableId: context.table?.id },
        reason: '读取目标表的字段结构。',
        status: context.base && context.table ? 'completed' : 'pending',
      });
    } else if (intent.kind === 'query_records') {
      const limitSlot = intent.slots.find((slot) => slot.name === 'limit');
      steps.push({
        type: 'query_records' as const,
        toolName: TOOL_NAMES.FEISHU_QUERY_RECORDS,
        input: {
          appId: context.appId,
          baseId: context.base?.id,
          tableId: context.table?.id,
          pageSize: typeof limitSlot?.value === 'number' ? limitSlot.value : 10,
        },
        reason: '查询目标表的记录。',
        status: context.base && context.table ? 'completed' : 'pending',
      });
    } else if (intent.kind === 'unknown' || intent.kind === 'write_request') {
      steps.push({
        type: 'clarify' as const,
        toolName: TOOL_NAMES.FEISHU_HANDLE_REQUEST,
        input: { query: intent.query },
        reason: '当前请求需要先澄清意图或等待后续阶段支持。',
        status: 'pending' as const,
      });
    }

    return {
      intent: intent.kind,
      steps,
    };
  }
}

export const feishuToolMapper = new FeishuToolMapper();
