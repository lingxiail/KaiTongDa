import type { ToolDefinition } from '../../../types';
import { feishuFacade } from '../../feishu/facade';
import { TOOL_NAMES } from '../toolNames';

function stringifyResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String) : undefined;
}

function toSortArray(value: unknown): Array<{ fieldName: string; desc?: boolean }> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.fieldName !== 'string' || !candidate.fieldName.trim()) return null;
      return {
        fieldName: candidate.fieldName,
        desc: typeof candidate.desc === 'boolean' ? candidate.desc : undefined,
      };
    })
    .filter((item): item is { fieldName: string; desc?: boolean } => item !== null);
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
  description: '列出当前已授权用户可访问的飞书多维表格 Base 列表。',
  inputSchema: {
    type: 'object',
    properties: {
      appId: { type: 'string', description: '飞书应用 App ID；默认使用最近一次连接的应用。' },
      pageSize: { type: 'number', description: '分页大小。' },
      pageToken: { type: 'string', description: '下一页游标。' },
      refresh: { type: 'boolean', description: '是否忽略缓存并重新拉取。' },
    },
    required: [],
  },
  execute: async (input) => {
    const result = await feishuFacade.listBases({
      appId: input.appId as string | undefined,
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
