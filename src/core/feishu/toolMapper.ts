import { TOOL_NAMES } from '../tools/toolNames';
import type { FeishuExecutionPlan, FeishuExecutionStep, FeishuIntent, FeishuIntentContext, FeishuIntentKind, FeishuIntentSlot } from './intentTypes';

function extractNumber(query: string): number | undefined {
  const matched = query.match(/(?:最近|最新|前|last|recent)?\s*(\d+)\s*条?(?:记录)?/i);
  if (!matched) return undefined;
  const value = Number(matched[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function extractBaseId(query: string): string | undefined {
  const urlMatch = query.match(/\/base\/([A-Za-z0-9_-]+)(?:[/?#\s]|$)/i)?.[1];
  if (urlMatch) return urlMatch;

  const labeledMatch = query.match(/(?:base\s*id|baseId|app[_\s-]?token|多维表格?ID|表格ID)\s*[:：]?\s*([A-Za-z0-9_-]{8,})/i)?.[1];
  if (labeledMatch) return labeledMatch;

  const prefixedMatch = query.match(/\b(app_[a-z0-9_-]+)\b/i)?.[1];
  if (prefixedMatch) return prefixedMatch;

  const contextualMatch = query.match(/(?:列出|查看|显示|打开)\s*([A-Za-z0-9_-]{12,})\s*(?:下|里面|里的|中|内)的?(?:所有)?(?:表|数据表)/i)?.[1];
  if (contextualMatch && !contextualMatch.toLowerCase().startsWith('tbl_')) {
    return contextualMatch;
  }

  return undefined;
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
  if (/(?:下|里面|里的|中|内)的?(?:所有)?(?:数据表|表)|数据表列表/i.test(query)) {
    return 'list_tables';
  }
  if (/(base|多维表格|多维表)/i.test(query)) {
    return 'list_bases';
  }
  if (/(?:列出|查看|显示).*(?:数据表|表)$/i.test(query)) {
    return 'list_tables';
  }
  return 'unknown';
}

function detectWriteToolName(query: string): string | undefined {
  if (/(upsert|不存在(?:则|就)?新增|有则更新|有就更新|匹配字段)/i.test(query)) {
    return TOOL_NAMES.FEISHU_UPSERT_RECORDS;
  }
  if (/(按条件更新|按筛选条件更新|根据筛选.*更新|批量更新|更新.*符合.*记录)/i.test(query)) {
    return TOOL_NAMES.FEISHU_UPDATE_RECORDS_BY_FILTER;
  }
  if (/(新增|创建|插入|添加).*(记录|行)?/i.test(query)) {
    return TOOL_NAMES.FEISHU_CREATE_RECORDS;
  }
  return undefined;
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
        status: context.authStatus ? 'completed' : 'pending',
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
        input: { appId: context.appId, refresh: true },
        reason: '调用稳定的 Base 查询工具，列出当前云空间根目录或指定文件夹中的 Base。',
        status: 'pending' as const,
      });
    } else if (intent.kind === 'list_tables') {
      steps.push({
        type: 'list_tables' as const,
        toolName: TOOL_NAMES.FEISHU_LIST_TABLES,
        input: { appId: context.appId, baseId: context.base?.id },
        reason: '调用稳定的 Table 查询工具，列出目标 Base 下的数据表。',
        status: 'pending' as const,
      });
    } else if (intent.kind === 'get_table_schema') {
      steps.push({
        type: 'get_table_schema' as const,
        toolName: TOOL_NAMES.FEISHU_GET_TABLE_SCHEMA,
        input: { appId: context.appId, baseId: context.base?.id, tableId: context.table?.id },
        reason: '调用稳定的表结构工具，读取目标表的字段定义。',
        status: 'pending' as const,
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
        reason: '调用稳定的记录查询工具，读取目标表记录。',
        status: 'pending' as const,
      });
    } else if (intent.kind === 'write_request') {
      const toolName = detectWriteToolName(intent.query);
      steps.push({
        type: 'clarify' as const,
        toolName: toolName || TOOL_NAMES.FEISHU_HANDLE_REQUEST,
        input: {
          appId: context.appId,
          baseId: context.base?.id,
          tableId: context.table?.id,
        },
        reason: toolName
          ? '自然语言入口只做写入规划；请继续调用对应的结构化写入工具。'
          : '当前仍需补充明确的写入动作，再决定使用哪一个结构化写入工具。',
        status: 'pending' as const,
      });
    } else if (intent.kind === 'unknown') {
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
