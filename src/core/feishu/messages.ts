import type { FeishuResourceCandidate } from './intentTypes';

function quoteNames(candidates: FeishuResourceCandidate[]): string {
  return candidates.map((item) => `「${item.name}」`).join('、');
}

export function buildNeedConnectMessage(): string {
  return '当前尚未建立飞书连接。请先连接飞书，或在本次请求中补充 appId 和 appSecret。';
}

export function buildNeedCredentialsMessage(): string {
  return '要继续连接飞书，请补充 appId 和 appSecret。';
}

export function buildMissingBaseQuestion(): string {
  return '你想操作哪个 Base？请告诉我 Base 名称或直接提供 baseId。';
}

export function buildMissingTableQuestion(baseName?: string): string {
  if (baseName) {
    return `你想查看 Base「${baseName}」下的哪张表？请告诉我表名或 tableId。`;
  }
  return '你想操作哪张表？请告诉我表名，必要时也可以同时提供所属 Base 名称。';
}

export function buildAmbiguousBaseQuestion(candidates: FeishuResourceCandidate[]): string {
  return `找到了多个同名或相近的 Base：${quoteNames(candidates)}。请明确告诉我你要用哪一个。`;
}

export function buildAmbiguousTableQuestion(candidates: FeishuResourceCandidate[]): string {
  return `找到了多个同名或相近的表：${quoteNames(candidates)}。请明确告诉我你要用哪一张。`;
}

export function buildUnsupportedWriteMessage(): string {
  return '当前自然语言飞书入口仍以连接与只读闭环为主；阶段 D 已提供结构化写入工具，自然语言写入编排稍后补齐。';
}

export function buildUnknownIntentMessage(): string {
  return '我暂时没能稳定识别这条飞书请求。你可以换一种说法，例如“列出我的 Base”或“查看客户表字段”。';
}
