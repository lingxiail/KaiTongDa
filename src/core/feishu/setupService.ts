import type { FeishuConnectorAdapter } from './connectorAdapter';
import { detectFeishuEnvironment, toEnvironmentFailureStatus } from './env';
import { normalizeFeishuCliError } from './errorNormalizer';
import { larkCliAdapter } from './larkCliAdapter';
import type { FeishuCliSetupInput, FeishuCliSetupResult, FeishuEnvironmentStatus } from './types';

function extractUrl(output: string): string | undefined {
  return output.match(/https?:\/\/[^\s"'`]+/i)?.[0];
}

function buildResult(input: Omit<FeishuCliSetupResult, 'lastUpdatedAt'>): FeishuCliSetupResult {
  return {
    ...input,
    lastUpdatedAt: Date.now(),
  };
}

function buildEnvironmentFailure(environment: FeishuEnvironmentStatus): FeishuCliSetupResult {
  const status = toEnvironmentFailureStatus(environment);
  return buildResult({
    success: false,
    phase: 'failed',
    environment,
    command: environment.installCommand,
    message: status.message,
    nextAction: status.nextAction,
  });
}

export class FeishuCliSetupService {
  private readonly adapter: FeishuConnectorAdapter;

  constructor(adapter: FeishuConnectorAdapter = larkCliAdapter) {
    this.adapter = adapter;
  }

  async setup(input: FeishuCliSetupInput = {}): Promise<FeishuCliSetupResult> {
    let environment = await detectFeishuEnvironment(this.adapter);

    if (!environment.nodeAvailable || !environment.npxAvailable) {
      return buildEnvironmentFailure(environment);
    }

    if (!environment.cliAvailable) {
      if (!input.installCli) {
        return buildEnvironmentFailure(environment);
      }

      const install = await this.adapter.installCli();
      if (install.code !== 0) {
        const normalized = normalizeFeishuCliError(install.stderr, install.stdout);
        return buildResult({
          success: false,
          phase: 'failed',
          environment,
          command: install.command,
          message: normalized.message,
          nextAction: normalized.nextAction,
        });
      }

      environment = await detectFeishuEnvironment(this.adapter);
      if (!environment.cliAvailable) {
        return buildEnvironmentFailure(environment);
      }
    }

    if (input.installSkill) {
      const skill = await this.adapter.installSkill();
      if (skill.code !== 0) {
        const normalized = normalizeFeishuCliError(skill.stderr, skill.stdout);
        return buildResult({
          success: false,
          phase: 'failed',
          environment,
          command: skill.command,
          message: normalized.message,
          nextAction: normalized.nextAction,
        });
      }
    }

    if (input.initializeConfig) {
      const configLines: string[] = [];
      const config = await this.adapter.initializeConfig((line) => {
        configLines.push(line);
      });
      const configOutput = `${configLines.join('\n')}\n${config.stdout}\n${config.stderr}`;
      const configUrl = extractUrl(configOutput);
      if (configUrl || config.code !== 0) {
        if (configUrl) {
          return buildResult({
            success: true,
            phase: 'config_pending',
            environment,
            configUrl,
            command: config.command,
            message: '应用配置流程已启动，请打开配置链接完成应用配置。',
            nextAction: '打开 configUrl 完成应用配置；完成后再次调用 feishu_setup_cli 发起登录。',
          });
        }

        const normalized = normalizeFeishuCliError(config.stderr, config.stdout);
        return buildResult({
          success: false,
          phase: 'failed',
          environment,
          command: config.command,
          message: normalized.message,
          nextAction: normalized.nextAction,
        });
      }
    }

    if (input.startLogin) {
      const loginLines: string[] = [];
      const login = await this.adapter.startLogin(
        {
          appId: '',
          appSecret: '',
          domain: input.domain,
          preferredScopes: input.preferredScopes,
          port: input.port,
          noWait: true,
          json: true,
        },
        (line) => {
          loginLines.push(line);
        },
      );
      const initialRaw = await Promise.race([
        login.completion,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 300)),
      ]);
      const loginOutput = initialRaw ? `${loginLines.join('\n')}\n${initialRaw.stdout}\n${initialRaw.stderr}` : loginLines.join('\n');
      const authUrl = extractUrl(loginOutput);
      return buildResult({
        success: true,
        phase: 'login_pending',
        environment,
        authUrl,
        command: login.command,
        message: authUrl ? '授权已发起，请打开授权链接完成确认。' : '授权流程已启动，请在飞书客户端或浏览器完成确认。',
        nextAction: '完成授权后调用 feishu_setup_cli 并传入 verifyAuth=true 验证状态。',
      });
    }

    if (input.verifyAuth) {
      const status = await this.adapter.getAuthStatus();
      if (status.code === 0) {
        return buildResult({
          success: true,
          phase: 'ready',
          environment,
          command: status.command,
          message: '飞书 CLI 已安装并完成登录验证。',
          nextAction: '可以继续使用飞书相关工具。',
        });
      }

      const normalized = normalizeFeishuCliError(status.stderr, status.stdout);
      return buildResult({
        success: false,
        phase: 'failed',
        environment,
        command: status.command,
        message: normalized.message,
        nextAction: normalized.nextAction,
      });
    }

    return buildResult({
      success: true,
      phase: 'ready',
      environment,
      message: '飞书 CLI 环境已可用。',
      nextAction: '如需继续配置应用，请调用 feishu_setup_cli 并传入 initializeConfig=true。',
    });
  }
}

export const feishuCliSetupService = new FeishuCliSetupService();
