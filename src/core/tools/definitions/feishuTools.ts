import type { ToolDefinition } from '../../../types';
import { feishuFacade } from '../../feishu/facade';
import { TOOL_NAMES } from '../toolNames';

function stringifyResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
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
