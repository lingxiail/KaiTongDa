import type { FeishuResourceCandidate } from './intentTypes';
import type { FeishuWriteAction } from './types';

type FeishuLocale = 'zh-CN' | 'en-US';

const FEISHU_MESSAGES: Record<FeishuLocale, {
  needConnect: string;
  needCredentials: string;
  missingBase: string;
  missingTableWithBase: string;
  missingTableWithoutBase: string;
  unsupportedWrite: string;
  unknownIntent: string;
  cliVersionUnknown: string;
  cliVersionUntested: string;
}> = {
  'zh-CN': {
    needConnect: '当前尚未建立飞书连接。请先连接飞书，或在本次请求中补充 appId 和 appSecret。',
    needCredentials: '要继续连接飞书，请补充 appId 和 appSecret。',
    missingBase: '你想操作哪个 Base？请告诉我 Base 名称或直接提供 baseId。',
    missingTableWithBase: '你想查看 Base「{baseName}」下的哪张表？请告诉我表名或 tableId。',
    missingTableWithoutBase: '你想操作哪张表？请告诉我表名，必要时也可以同时提供所属 Base 名称。',
    unsupportedWrite: '当前自然语言飞书入口仍以连接与只读闭环为主；阶段 D 已提供结构化写入工具，自然语言写入编排稍后补齐。',
    unknownIntent: '我暂时没能稳定识别这条飞书请求。你可以换一种说法，例如“列出我的 Base”或“查看客户表字段”。',
    cliVersionUnknown: '尚未识别出飞书 CLI 版本，建议先确认当前安装版本是否在已验证范围内。',
    cliVersionUntested: '当前飞书 CLI 版本 {version} 超出已验证范围 {range}，建议优先回归关键链路。',
  },
  'en-US': {
    needConnect: 'Feishu is not connected yet. Connect first, or provide appId and appSecret in this request.',
    needCredentials: 'Please provide appId and appSecret to continue connecting Feishu.',
    missingBase: 'Which Base do you want to use? Tell me the Base name or provide baseId directly.',
    missingTableWithBase: 'Which table under Base "{baseName}" do you want to use? Tell me the table name or tableId.',
    missingTableWithoutBase: 'Which table do you want to use? Tell me the table name, and optionally the Base name too.',
    unsupportedWrite: 'The natural-language Feishu entry still focuses on connect and read-only flows. Stage D write tools are ready, while natural-language write orchestration comes later.',
    unknownIntent: 'I could not reliably identify this Feishu request yet. Try a phrasing like "list my Bases" or "show fields of customer table".',
    cliVersionUnknown: 'The Feishu CLI version could not be recognized. Please verify whether the installed version is within the validated range.',
    cliVersionUntested: 'Feishu CLI version {version} is outside the validated range {range}. Please run key regression checks first.',
  },
};

function quoteNames(candidates: FeishuResourceCandidate[]): string {
  return candidates.map((item) => `「${item.name}」`).join('、');
}

function format(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? '');
}

function getLocaleMessages(locale: FeishuLocale = 'zh-CN') {
  return FEISHU_MESSAGES[locale];
}

export function buildNeedConnectMessage(locale: FeishuLocale = 'zh-CN'): string {
  return getLocaleMessages(locale).needConnect;
}

export function buildNeedCredentialsMessage(locale: FeishuLocale = 'zh-CN'): string {
  return getLocaleMessages(locale).needCredentials;
}

export function buildMissingBaseQuestion(locale: FeishuLocale = 'zh-CN'): string {
  return getLocaleMessages(locale).missingBase;
}

export function buildMissingTableQuestion(baseName?: string, locale: FeishuLocale = 'zh-CN'): string {
  if (baseName) {
    return format(getLocaleMessages(locale).missingTableWithBase, { baseName });
  }
  return getLocaleMessages(locale).missingTableWithoutBase;
}

export function buildAmbiguousBaseQuestion(candidates: FeishuResourceCandidate[]): string {
  return `找到了多个同名或相近的 Base：${quoteNames(candidates)}。请明确告诉我你要用哪一个。`;
}

export function buildAmbiguousTableQuestion(candidates: FeishuResourceCandidate[]): string {
  return `找到了多个同名或相近的表：${quoteNames(candidates)}。请明确告诉我你要用哪一张。`;
}

export function buildUnsupportedWriteMessage(locale: FeishuLocale = 'zh-CN'): string {
  return getLocaleMessages(locale).unsupportedWrite;
}

export function buildUnknownIntentMessage(locale: FeishuLocale = 'zh-CN'): string {
  return getLocaleMessages(locale).unknownIntent;
}

export function buildCliCompatibilityMessage(
  version: string | null | undefined,
  range: string,
  locale: FeishuLocale = 'zh-CN',
): string {
  if (!version) {
    return getLocaleMessages(locale).cliVersionUnknown;
  }
  return format(getLocaleMessages(locale).cliVersionUntested, {
    version,
    range,
  });
}

export function buildWriteConfirmationMessage(action: FeishuWriteAction, count: number, threshold: number): string {
  if (action === 'update_by_filter') {
    return `本次更新命中 ${count} 条记录，超过确认阈值 ${threshold}，请显式确认后再执行。`;
  }
  return `本次${action === 'create' ? '新增' : 'upsert'}将写入 ${count} 条记录，超过确认阈值 ${threshold}，请显式确认后再执行。`;
}
