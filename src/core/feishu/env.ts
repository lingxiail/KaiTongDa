import { assessCliCompatibility } from './compat';
import type { FeishuConnectorAdapter } from './connectorAdapter';
import { FEISHU_ERROR_CODES } from './errorCodes';
import { larkMcpAdapter } from './larkMcpAdapter';
import { buildCliCompatibilityMessage } from './messages';
import type { FeishuConnectionStatus, FeishuEnvironmentStatus } from './types';

function trimVersion(raw: string): string | null {
  const line = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  return line || null;
}

export async function detectFeishuEnvironment(
  adapter: FeishuConnectorAdapter = larkMcpAdapter,
): Promise<FeishuEnvironmentStatus> {
  let nodeVersion: string | null = null;
  let cliVersion: string | null = null;
  let nodeAvailable: boolean;
  let cliAvailable: boolean;

  try {
    const node = await adapter.checkNodeVersion();
    nodeAvailable = node.code === 0;
    nodeVersion = trimVersion(node.stdout || node.stderr);
  } catch {
    nodeAvailable = false;
  }

  try {
    const cli = await adapter.checkCliVersion();
    cliAvailable = cli.code === 0;
    cliVersion = trimVersion(cli.stdout || cli.stderr);
  } catch {
    cliAvailable = false;
  }

  if (!nodeAvailable) {
    return {
      nodeAvailable: false,
      cliAvailable,
      nodeVersion,
      cliVersion,
      message: '未检测到可用的 Node.js 环境。',
    };
  }

  if (!cliAvailable) {
    return {
      nodeAvailable: true,
      cliAvailable: false,
      nodeVersion,
      cliVersion,
      message: '未检测到可用的飞书 Lark MCP CLI。',
    };
  }

  const compatibility = assessCliCompatibility(cliVersion);
  const message = compatibility.status === 'compatible'
    ? `环境可用，CLI 版本：${cliVersion ?? 'unknown'}`
    : buildCliCompatibilityMessage(compatibility.detectedVersion, compatibility.supportedRange);

  return {
    nodeAvailable: true,
    cliAvailable: true,
    nodeVersion,
    cliVersion,
    compatibility,
    message,
  };
}

export function toEnvironmentFailureStatus(env: FeishuEnvironmentStatus, appId?: string, domain?: string): FeishuConnectionStatus {
  const errorCode = env.nodeAvailable
    ? FEISHU_ERROR_CODES.CLI_UNAVAILABLE
    : FEISHU_ERROR_CODES.NODE_MISSING;

  return {
    success: false,
    connected: false,
    state: 'unauthorized',
    phase: 'failed',
    message: env.message,
    nextAction: env.nodeAvailable ? '请先安装或修复 @larksuiteoapi/lark-mcp。' : '请先安装 Node.js LTS，并确认 node 命令可用。',
    errorCode,
    appId,
    domain,
    account: null,
    tenant: null,
    lastUpdatedAt: Date.now(),
  };
}
