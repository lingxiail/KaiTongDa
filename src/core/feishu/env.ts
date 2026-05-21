import { assessCliCompatibility } from './compat';
import type { FeishuConnectorAdapter } from './connectorAdapter';
import { FEISHU_ERROR_CODES } from './errorCodes';
import { buildCliInstallCommand } from './larkCliCommands';
import { larkCliAdapter } from './larkCliAdapter';
import { buildCliCompatibilityMessage } from './messages';
import type { FeishuConnectionStatus, FeishuEnvironmentStatus } from './types';

const CLI_INSTALL_COMMAND = buildCliInstallCommand().command;

function trimVersion(raw: string): string | null {
  const line = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  return line || null;
}

export async function detectFeishuEnvironment(
  adapter: FeishuConnectorAdapter = larkCliAdapter,
): Promise<FeishuEnvironmentStatus> {
  let nodeVersion: string | null = null;
  let npxVersion: string | null = null;
  let cliVersion: string | null = null;
  let nodeAvailable: boolean;
  let npxAvailable = false;
  let cliAvailable: boolean;

  try {
    const node = await adapter.checkNodeVersion();
    nodeAvailable = node.code === 0;
    nodeVersion = trimVersion(node.stdout || node.stderr);
  } catch {
    nodeAvailable = false;
  }

  if (nodeAvailable) {
    try {
      const npx = await adapter.checkNpxVersion();
      npxAvailable = npx.code === 0;
      npxVersion = trimVersion(npx.stdout || npx.stderr);
    } catch {
      npxAvailable = false;
    }
  }

  if (!nodeAvailable) {
    return {
      nodeAvailable: false,
      npxAvailable: false,
      cliAvailable: false,
      nodeVersion,
      npxVersion,
      cliVersion,
      installCommand: CLI_INSTALL_COMMAND,
      canAutoInstall: false,
      failureReason: 'node_missing',
      message: '未检测到可用的 Node.js 环境。',
    };
  }

  if (!npxAvailable) {
    return {
      nodeAvailable: true,
      npxAvailable: false,
      cliAvailable: false,
      nodeVersion,
      npxVersion,
      cliVersion,
      installCommand: CLI_INSTALL_COMMAND,
      canAutoInstall: false,
      failureReason: 'npx_missing',
      message: '已检测到 Node.js，但未检测到可用的 npx。',
    };
  }

  try {
    const cli = await adapter.checkCliVersion();
    cliAvailable = cli.code === 0;
    cliVersion = trimVersion(cli.stdout || cli.stderr);
    if (!cliAvailable && /network|timed out|econn|fetch failed|download/i.test(`${cli.stdout}\n${cli.stderr}`)) {
      return {
        nodeAvailable: true,
        npxAvailable: true,
        cliAvailable: false,
        nodeVersion,
        npxVersion,
        cliVersion,
        installCommand: CLI_INSTALL_COMMAND,
        canAutoInstall: true,
        failureReason: 'network_error',
        message: '检测 lark-cli 时发生网络错误，请确认网络连通后重试。',
      };
    }
  } catch {
    cliAvailable = false;
  }

  if (!cliAvailable) {
    return {
      nodeAvailable: true,
      npxAvailable: true,
      cliAvailable: false,
      nodeVersion,
      npxVersion,
      cliVersion,
      installCommand: CLI_INSTALL_COMMAND,
      canAutoInstall: true,
      failureReason: 'cli_missing',
      message: '未检测到可用的 lark-cli。',
    };
  }

  const compatibility = assessCliCompatibility(cliVersion);
  if (compatibility.status === 'untested') {
    return {
      nodeAvailable: true,
      npxAvailable: true,
      cliAvailable: true,
      nodeVersion,
      npxVersion,
      cliVersion,
      compatibility,
      installCommand: CLI_INSTALL_COMMAND,
      canAutoInstall: false,
      failureReason: 'incompatible_version',
      message: buildCliCompatibilityMessage(compatibility.detectedVersion, compatibility.supportedRange),
    };
  }

  return {
    nodeAvailable: true,
    npxAvailable: true,
    cliAvailable: true,
    nodeVersion,
    npxVersion,
    cliVersion,
    compatibility,
    installCommand: CLI_INSTALL_COMMAND,
    canAutoInstall: false,
    message: `环境可用，CLI 版本：${cliVersion ?? 'unknown'}`,
  };
}

export function toEnvironmentFailureStatus(env: FeishuEnvironmentStatus, appId?: string, domain?: string): FeishuConnectionStatus {
  const errorCode = !env.nodeAvailable
    ? FEISHU_ERROR_CODES.NODE_MISSING
    : FEISHU_ERROR_CODES.CLI_UNAVAILABLE;
  const nextAction = env.failureReason === 'node_missing'
    ? '请先安装 Node.js LTS，并确认 node 与 npx 命令可用。'
    : env.failureReason === 'npx_missing'
      ? '请修复当前 Node.js 安装，确保 npx 命令可用。'
      : env.canAutoInstall && env.installCommand
        ? `确认后可执行安装命令：${env.installCommand}`
        : '请先安装或修复 lark-cli。';

  return {
    success: false,
    connected: false,
    state: 'unauthorized',
    phase: 'failed',
    message: env.message,
    nextAction,
    errorCode,
    appId,
    domain,
    account: null,
    tenant: null,
    lastUpdatedAt: Date.now(),
  };
}
