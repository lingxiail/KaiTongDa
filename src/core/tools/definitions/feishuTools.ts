import type { ToolDefinition } from '../../../types';
import { feishuFacade } from '../../feishu/facade';
import { TOOL_NAMES } from '../toolNames';

function stringifyResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String) : undefined;
}

function toObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => item as Record<string, unknown>);
}

function toSortArray(value: unknown): Array<{ fieldName: string; desc?: boolean }> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.reduce<Array<{ fieldName: string; desc?: boolean }>>((items, item) => {
    if (!item || typeof item !== 'object') return items;
      const candidate = item as Record<string, unknown>;
    if (typeof candidate.fieldName !== 'string' || !candidate.fieldName.trim()) return items;

    const sortRule: { fieldName: string; desc?: boolean } = {
      fieldName: candidate.fieldName.trim(),
    };
    if (typeof candidate.desc === 'boolean') {
      sortRule.desc = candidate.desc;
    }
    items.push(sortRule);
    return items;
  }, []);
}

export const feishuConnectTool: ToolDefinition = {
  name: TOOL_NAMES.FEISHU_CONNECT,
  description: '连接飞书并发起用户授权。适用于阶段 A 的连接闭环，返回结构化连接状态。',
  inputSchema: {
    type: 'object',
    properties: {
      appId: { type: 'string', description: '飞书应用 App ID' },
      appSecret: { type: 'string', description: '飞书应用 App Secret' },
      domain: { type: 'string', description: '飞书开放平台域名，默认 https://open.feishu.cn' },
      preferredScopes: {
        type: 'array',
        description: 'OAuth scopes 列表，默认使用应用已授予的全部权限',
        items: { type: 'string' },
      },
      interactive: { type: 'boolean', description: '是否按交互式连接处理，默认 true' },
      waitForMs: { type: 'number', description: '本次连接等待授权完成的时长，单位毫秒' },
      port: { type: 'number', description: '本地 OAuth 回调端口，默认 3000' },
    },
    required: ['appId', 'appSecret'],
  },
  execute: async (input) => {
    const result = await feishuFacade.connect({
      appId: input.appId as string | undefined,
      appSecret: input.appSecret as string | undefined,
      domain: input.domain as string | undefined,
      preferredScopes: Array.isArray(input.preferredScopes)
        ? input.preferredScopes.map(String)
        : undefined,
      interactive: input.interactive as boolean | undefined,
      waitForMs: typeof input.waitForMs === 'number' ? input.waitForMs : undefined,
      port: typeof input.port === 'number' ? input.port : undefined,
    });
    return stringifyResult(result);
  },
  isConcurrencySafe: false,
};

export const feishuAuthStatusTool: ToolDefinition = {
  name: TOOL_NAMES.FEISHU_AUTH_STATUS,
  description: '查询当前飞书连接状态，返回结构化账号摘要与授权状态。',
  inputSchema: {
    type: 'object',
    properties: {
      appId: { type: 'string', description: '飞书应用 App ID' },
      domain: { type: 'string', description: '飞书开放平台域名' },
    },
    required: [],
  },
  execute: async (input) => {
    const result = await feishuFacade.getAuthStatus({
      appId: input.appId as string | undefined,
      domain: input.domain as string | undefined,
    });
    return stringifyResult(result);
  },
  isConcurrencySafe: true,
};

export const feishuDisconnectTool: ToolDefinition = {
  name: TOOL_NAMES.FEISHU_DISCONNECT,
  description: '断开当前飞书连接并清理本地连接状态缓存。',
  inputSchema: {
    type: 'object',
    properties: {
      appId: { type: 'string', description: '飞书应用 App ID' },
      domain: { type: 'string', description: '飞书开放平台域名' },
    },
    required: [],
  },
  execute: async (input) => {
    const result = await feishuFacade.disconnect({
      appId: input.appId as string | undefined,
      domain: input.domain as string | undefined,
    });
    return stringifyResult(result);
  },
  isConcurrencySafe: false,
};

export const feishuListBasesTool: ToolDefinition = {
  name: TOOL_NAMES.FEISHU_LIST_BASES,
  description: '列出当前已授权用户云空间根目录或指定文件夹中的飞书多维表格 Base。底层是 Drive 文件夹清单接口，不保证覆盖账号下所有可读或共享 Base。',
  inputSchema: {
    type: 'object',
    properties: {
      appId: { type: 'string', description: '飞书应用 App ID；默认使用最近一次连接的应用。' },
      folderToken: { type: 'string', description: '可选。飞书云空间文件夹 token；不传时只列根目录。' },
      pageSize: { type: 'number', description: '分页大小。' },
      pageToken: { type: 'string', description: '下一页游标。' },
      refresh: { type: 'boolean', description: '是否忽略缓存并重新拉取。' },
    },
    required: [],
  },
  execute: async (input) => {
    const result = await feishuFacade.listBases({
      appId: input.appId as string | undefined,
      folderToken: input.folderToken as string | undefined,
      pageSize: typeof input.pageSize === 'number' ? input.pageSize : undefined,
      pageToken: input.pageToken as string | undefined,
      refresh: input.refresh as boolean | undefined,
    });
    return stringifyResult(result);
  },
  isConcurrencySafe: true,
};

export const feishuListTablesTool: ToolDefinition = {
  name: TOOL_NAMES.FEISHU_LIST_TABLES,
  description: '列出指定 Base 下的数据表列表。',
  inputSchema: {
    type: 'object',
    properties: {
      appId: { type: 'string', description: '飞书应用 App ID；默认使用最近一次连接的应用。' },
      baseId: { type: 'string', description: 'Base ID（即 app_token）。' },
      pageSize: { type: 'number', description: '分页大小。' },
      pageToken: { type: 'string', description: '下一页游标。' },
      refresh: { type: 'boolean', description: '是否忽略缓存并重新拉取。' },
    },
    required: ['baseId'],
  },
  execute: async (input) => {
    const result = await feishuFacade.listTables({
      appId: input.appId as string | undefined,
      baseId: input.baseId as string,
      pageSize: typeof input.pageSize === 'number' ? input.pageSize : undefined,
      pageToken: input.pageToken as string | undefined,
      refresh: input.refresh as boolean | undefined,
    });
    return stringifyResult(result);
  },
  isConcurrencySafe: true,
};

export const feishuGetTableSchemaTool: ToolDefinition = {
  name: TOOL_NAMES.FEISHU_GET_TABLE_SCHEMA,
  description: '读取指定 Base/Table 的字段结构定义。',
  inputSchema: {
    type: 'object',
    properties: {
      appId: { type: 'string', description: '飞书应用 App ID；默认使用最近一次连接的应用。' },
      baseId: { type: 'string', description: 'Base ID（即 app_token）。' },
      tableId: { type: 'string', description: '数据表 ID。' },
      pageSize: { type: 'number', description: '分页大小。' },
      pageToken: { type: 'string', description: '下一页游标。' },
      refresh: { type: 'boolean', description: '是否忽略缓存并重新拉取。' },
    },
    required: ['baseId', 'tableId'],
  },
  execute: async (input) => {
    const result = await feishuFacade.getTableSchema({
      appId: input.appId as string | undefined,
      baseId: input.baseId as string,
      tableId: input.tableId as string,
      pageSize: typeof input.pageSize === 'number' ? input.pageSize : undefined,
      pageToken: input.pageToken as string | undefined,
      refresh: input.refresh as boolean | undefined,
    });
    return stringifyResult(result);
  },
  isConcurrencySafe: true,
};

export const feishuQueryRecordsTool: ToolDefinition = {
  name: TOOL_NAMES.FEISHU_QUERY_RECORDS,
  description: '按分页、筛选和排序条件查询多维表格记录。',
  inputSchema: {
    type: 'object',
    properties: {
      appId: { type: 'string', description: '飞书应用 App ID；默认使用最近一次连接的应用。' },
      baseId: { type: 'string', description: 'Base ID（即 app_token）。' },
      tableId: { type: 'string', description: '数据表 ID。' },
      viewId: { type: 'string', description: '可选视图 ID。' },
      fieldNames: {
        type: 'array',
        description: '限制返回的字段名列表。',
        items: { type: 'string' },
      },
      filter: {
        type: 'object',
        description: '结构化筛选条件对象，直接透传到飞书记录搜索接口。',
      },
      sort: {
        type: 'array',
        description: '排序规则数组，元素格式为 { fieldName, desc }。',
        items: {
          type: 'object',
          properties: {
            fieldName: { type: 'string', description: '字段名。' },
            desc: { type: 'boolean', description: '是否降序。' },
          },
          required: ['fieldName'],
        },
      },
      pageSize: { type: 'number', description: '分页大小。' },
      pageToken: { type: 'string', description: '下一页游标。' },
    },
    required: ['baseId', 'tableId'],
  },
  execute: async (input) => {
    const result = await feishuFacade.queryRecords({
      appId: input.appId as string | undefined,
      baseId: input.baseId as string,
      tableId: input.tableId as string,
      viewId: input.viewId as string | undefined,
      fieldNames: toStringArray(input.fieldNames),
      filter: input.filter && typeof input.filter === 'object' ? input.filter as Record<string, unknown> : undefined,
      sort: toSortArray(input.sort),
      pageSize: typeof input.pageSize === 'number' ? input.pageSize : undefined,
      pageToken: input.pageToken as string | undefined,
    });
    return stringifyResult(result);
  },
  isConcurrencySafe: true,
};

export const feishuCreateRecordsTool: ToolDefinition = {
  name: TOOL_NAMES.FEISHU_CREATE_RECORDS,
  description: '向指定飞书多维表格批量新增记录，返回结构化写入结果与审计摘要。',
  inputSchema: {
    type: 'object',
    properties: {
      appId: { type: 'string', description: '飞书应用 App ID；默认使用最近一次连接的应用。' },
      baseId: { type: 'string', description: 'Base ID（即 app_token）。' },
      tableId: { type: 'string', description: '数据表 ID。' },
      records: {
        type: 'array',
        description: '待新增的记录数组，每个元素都是字段名到字段值的对象。',
        items: { type: 'object' },
      },
      confirmed: { type: 'boolean', description: '若命中高风险阈值，显式确认后再执行。' },
    },
    required: ['baseId', 'tableId', 'records'],
  },
  execute: async (input) => {
    const result = await feishuFacade.createRecords({
      appId: input.appId as string | undefined,
      baseId: input.baseId as string,
      tableId: input.tableId as string,
      records: toRecordArray(input.records) ?? [],
      confirmed: input.confirmed as boolean | undefined,
    });
    return stringifyResult(result);
  },
  isConcurrencySafe: false,
};

export const feishuUpsertRecordsTool: ToolDefinition = {
  name: TOOL_NAMES.FEISHU_UPSERT_RECORDS,
  description: '按显式匹配字段执行飞书记录 upsert，返回新增/更新数量和失败明细。',
  inputSchema: {
    type: 'object',
    properties: {
      appId: { type: 'string', description: '飞书应用 App ID；默认使用最近一次连接的应用。' },
      baseId: { type: 'string', description: 'Base ID（即 app_token）。' },
      tableId: { type: 'string', description: '数据表 ID。' },
      records: {
        type: 'array',
        description: '待 upsert 的记录数组，每个元素都是字段名到字段值的对象。',
        items: { type: 'object' },
      },
      matchByFields: {
        type: 'array',
        description: '显式匹配字段列表，用于判断新增还是更新。',
        items: { type: 'string' },
      },
      confirmed: { type: 'boolean', description: '若命中高风险阈值，显式确认后再执行。' },
    },
    required: ['baseId', 'tableId', 'records', 'matchByFields'],
  },
  execute: async (input) => {
    const result = await feishuFacade.upsertRecords({
      appId: input.appId as string | undefined,
      baseId: input.baseId as string,
      tableId: input.tableId as string,
      records: toRecordArray(input.records) ?? [],
      matchByFields: toStringArray(input.matchByFields) ?? [],
      confirmed: input.confirmed as boolean | undefined,
    });
    return stringifyResult(result);
  },
  isConcurrencySafe: false,
};

export const feishuUpdateRecordsByFilterTool: ToolDefinition = {
  name: TOOL_NAMES.FEISHU_UPDATE_RECORDS_BY_FILTER,
  description: '按筛选条件批量更新飞书记录，支持高风险阈值确认。',
  inputSchema: {
    type: 'object',
    properties: {
      appId: { type: 'string', description: '飞书应用 App ID；默认使用最近一次连接的应用。' },
      baseId: { type: 'string', description: 'Base ID（即 app_token）。' },
      tableId: { type: 'string', description: '数据表 ID。' },
      filter: { type: 'object', description: '结构化筛选条件对象。' },
      fields: { type: 'object', description: '要更新的字段对象。' },
      confirmed: { type: 'boolean', description: '若命中高风险阈值，显式确认后再执行。' },
    },
    required: ['baseId', 'tableId', 'filter', 'fields'],
  },
  execute: async (input) => {
    const result = await feishuFacade.updateRecordsByFilter({
      appId: input.appId as string | undefined,
      baseId: input.baseId as string,
      tableId: input.tableId as string,
      filter: toObject(input.filter) ?? {},
      fields: toObject(input.fields) ?? {},
      confirmed: input.confirmed as boolean | undefined,
    });
    return stringifyResult(result);
  },
  isConcurrencySafe: false,
};

export const feishuHandleRequestTool: ToolDefinition = {
  name: TOOL_NAMES.FEISHU_HANDLE_REQUEST,
  description: [
    '承接飞书多维表格自然语言请求。',
    '适用于“连接飞书”“列出我的 Base”“查看客户表字段”“帮我查飞书客户表最近 10 条记录”等场景。',
    '内部会完成意图识别、最近上下文补全、资源歧义澄清和只读执行编排。',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '用户的飞书自然语言请求。' },
      appId: { type: 'string', description: '可选飞书应用 App ID。连接或切换应用时使用。' },
      appSecret: { type: 'string', description: '可选飞书应用 App Secret。连接时使用。' },
      domain: { type: 'string', description: '可选飞书开放平台域名。' },
      conversationContext: {
        type: 'object',
        description: '可选会话上下文，可提供 baseId、baseName、tableId、tableName 等最近资源信息。',
      },
    },
    required: ['query'],
  },
  execute: async (input) => {
    const result = await feishuFacade.handleRequest({
      query: input.query as string,
      appId: input.appId as string | undefined,
      appSecret: input.appSecret as string | undefined,
      domain: input.domain as string | undefined,
      conversationContext: input.conversationContext && typeof input.conversationContext === 'object'
        ? input.conversationContext as Record<string, unknown>
        : undefined,
    });
    return stringifyResult(result);
  },
  isConcurrencySafe: false,
};
