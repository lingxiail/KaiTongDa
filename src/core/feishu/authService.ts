import { FEISHU_ERROR_CODES } from './errorCodes';
import type { FeishuConnectorAdapter } from './connectorAdapter';
import { detectFeishuEnvironment, toEnvironmentFailureStatus } from './env';
import { normalizeFeishuCliError } from './errorNormalizer';
import { larkCliAdapter } from './larkCliAdapter';
import type {
  FeishuAccountSummary,
  FeishuConnectInput,
  FeishuConnectionStatus,
  FeishuPersistedLoginState,
  FeishuTenantSummary,
} from './types';
import { FeishuSessionStore, feishuSessionStore } from './sessionStore';

const DEFAULT_DOMAIN = 'https://open.feishu.cn';
const DEFAULT_CONNECT_WAIT_MS = 3000;
const ACTIVE_LOGIN_TTL_MS = 240000;

function normalizeDomain(input?: string): string {
  const trimmed = input?.trim().replace(/^`+|`+$/g, '').trim();
  return trimmed || DEFAULT_DOMAIN;
}

function parseAuthUrl(output: string): string | undefined {
  const match = output.match(/https?:\/\/[^\s"'`]+/i);
  return match?.[0];
}

function parseDeviceCode(output: string): string | undefined {
  const jsonMatch = output.match(/"device[_-]?code"\s*:\s*"([^"]+)"/i)?.[1];
  if (jsonMatch) return jsonMatch;
  return output.match(/(?:device[_\s-]?code|user[_\s-]?code)\s*[:=]\s*([A-Z0-9_-]+)/i)?.[1];
}

function parseAccountSummary(output: string): { account: FeishuAccountSummary | null; tenant: FeishuTenantSummary | null } {
  const account: FeishuAccountSummary = {};
  const tenant: FeishuTenantSummary = {};

  const name = output.match(/(?:^|\b)(?:name|user_name)\s*[:=]\s*([^\r\n]+)/im)?.[1]?.trim();
  const email = output.match(/(?:^|\b)email\s*[:=]\s*([^\r\n]+)/im)?.[1]?.trim();
  const authorizedAccount = output.match(/authorized account\s*[:=]\s*([^\r\n(]+)(?:\s*\(([^)]+)\))?/i);
  const userId = output.match(/(?:^|\b)(?:user_id|open_id)\s*[:=]\s*([^\r\n]+)/im)?.[1]?.trim();
  const tenantKey = output.match(/(?:^|\b)tenant(?:_key)?\s*[:=]\s*([^\r\n]+)/im)?.[1]?.trim();

  if (name || authorizedAccount?.[1]) account.name = name || authorizedAccount?.[1]?.trim();
  if (email || authorizedAccount?.[2]) account.email = email || authorizedAccount?.[2]?.trim();
  if (userId) account.userId = userId;
  if (tenantKey) tenant.tenantKey = tenantKey;

  return {
    account: Object.keys(account).length > 0 ? account : null,
    tenant: Object.keys(tenant).length > 0 ? tenant : null,
  };
}

function isApprovalPending(output: string): boolean {
  return /approval|approve|审批/i.test(output);
}

function isAuthorized(output: string): boolean {
  if (/no user logged in/i.test(output)) return false;
  return /authorized account|current authorized account|login successful|authorization successful|user[_\s-]?id|open[_\s-]?id|tenant[_\s-]?key|identity\s*:\s*(?!bot\b)/i.test(output);
}

function isUnauthenticated(output: string): boolean {
  return /not configured|not logged in|no logged in users|no user logged in|please run .*auth login|please run .*config init|unauthorized/i.test(output);
}

function isExpired(output: string): boolean {
  return /expired|invalid_grant|token expired/i.test(output);
}

function buildStatus(base: Partial<FeishuConnectionStatus> & Pick<FeishuConnectionStatus, 'message'>): FeishuConnectionStatus {
  return {
    success: base.success ?? false,
    connected: base.connected ?? false,
    state: base.state ?? 'unauthorized',
    phase: base.phase ?? 'idle',
    message: base.message,
    nextAction: base.nextAction,
    errorCode: base.errorCode,
    appId: base.appId,
    domain: base.domain,
    account: base.account ?? null,
    tenant: base.tenant ?? null,
    authUrl: base.authUrl,
    expiresAt: base.expiresAt ?? null,
    lastUpdatedAt: base.lastUpdatedAt ?? Date.now(),
  };
}

function buildPendingStatus(input: {
  appId?: string;
  domain?: string;
  login: FeishuPersistedLoginState;
}): FeishuConnectionStatus {
  return buildStatus({
    success: false,
    connected: false,
    state: input.login.state,
    phase: input.login.phase,
    message: input.login.message || (input.login.step === 'config'
      ? '应用配置流程已启动，请在浏览器或飞书客户端完成配置。'
      : '授权已启动，请在浏览器或飞书客户端完成确认。'),
    nextAction: input.login.nextAction || (input.login.step === 'config'
      ? '打开配置链接完成应用配置；完成后再次执行 feishu_connect 进入登录阶段。'
      : '打开授权链接完成确认；完成后调用 feishu_auth_status 查询连接状态。'),
    errorCode: FEISHU_ERROR_CODES.AUTH_PENDING,
    appId: input.appId,
    domain: input.domain || DEFAULT_DOMAIN,
    authUrl: input.login.authUrl,
  });
}

function buildCliSetupRequiredStatus(input: {
  appId?: string;
  domain?: string;
  message: string;
  nextAction: string;
  errorCode: FeishuConnectionStatus['errorCode'];
}): FeishuConnectionStatus {
  return buildStatus({
    success: false,
    connected: false,
    state: 'unauthorized',
    phase: 'failed',
    message: input.message,
    nextAction: input.nextAction,
    errorCode: input.errorCode,
    appId: input.appId,
    domain: input.domain,
  });
}

function buildConnectedStatus(input: {
  appId?: string;
  domain?: string;
  output: string;
  authUrl?: string;
}): FeishuConnectionStatus {
  const parsed = parseAccountSummary(input.output);
  return buildStatus({
    success: true,
    connected: true,
    state: 'connected',
    phase: 'connected',
    message: '飞书连接成功。',
    nextAction: '可继续查询授权状态或使用飞书相关工具。',
    appId: input.appId,
    domain: input.domain,
    account: parsed.account,
    tenant: parsed.tenant,
    authUrl: input.authUrl,
  });
}

function appendLoginOutput(input: {
  store: FeishuSessionStore;
  appId: string;
  line: string;
  message?: string;
}): void {
  const activeLogin = input.store.getActiveLogin(input.appId);
  if (!activeLogin) return;
  const output = [...activeLogin.outputLines, input.line].slice(-100);
  activeLogin.outputLines = output;
  activeLogin.authUrl = activeLogin.authUrl || parseAuthUrl(input.line);
  activeLogin.deviceCode = activeLogin.deviceCode || parseDeviceCode(input.line);
  activeLogin.message = input.message || activeLogin.message;
  input.store.setActiveLogin(input.appId, activeLogin);
}

export class FeishuAuthService {
  private readonly adapter: FeishuConnectorAdapter;
  private readonly store: FeishuSessionStore;

  constructor(
    adapter: FeishuConnectorAdapter = larkCliAdapter,
    store: FeishuSessionStore = feishuSessionStore,
  ) {
    this.adapter = adapter;
    this.store = store;
  }

  async checkAuthStatus(input?: Pick<FeishuConnectInput, 'appId' | 'domain'>): Promise<FeishuConnectionStatus> {
    const cached = this.store.getConnectionStatus(input?.appId);
    if (cached) {
      if (cached.state === 'approval_pending') {
        return buildStatus({ ...cached, message: cached.message || '授权仍在审批或等待确认中。' });
      }
      return cached;
    }

    const activeLogin = this.store.getActiveLogin(input?.appId);
    if (activeLogin) {
      if (activeLogin.timeoutAt && Date.now() > activeLogin.timeoutAt) {
        const expiredStatus = buildStatus({
          success: false,
          connected: false,
          state: 'auth_expired',
          phase: 'auth_expired',
          message: '授权流程已超时，请重新发起连接。',
          nextAction: '重新执行 feishu_connect。',
          errorCode: FEISHU_ERROR_CODES.AUTH_TIMEOUT,
          appId: input?.appId,
          domain: input?.domain || DEFAULT_DOMAIN,
          authUrl: activeLogin.authUrl,
        });
        this.store.updateConnectionStatus(input?.appId, expiredStatus);
        this.store.setActiveLogin(input?.appId, null);
        return expiredStatus;
      }

      return buildPendingStatus({
        appId: input?.appId,
        domain: input?.domain,
        login: activeLogin,
      });
    }

    return buildStatus({
      success: false,
      connected: false,
      state: 'unauthorized',
      phase: 'idle',
      message: '当前尚未建立飞书连接。',
      nextAction: '请先执行 feishu_connect。',
      errorCode: FEISHU_ERROR_CODES.AUTH_REQUIRED,
      appId: input?.appId,
      domain: input?.domain || DEFAULT_DOMAIN,
    });
  }

  async startLogin(input: FeishuConnectInput): Promise<FeishuConnectionStatus> {
    const appId = input.appId?.trim();
    const appSecret = input.appSecret?.trim();
    const domain = normalizeDomain(input.domain);

    if (!appId) {
      return buildStatus({
        success: false,
        connected: false,
        state: 'unauthorized',
        phase: 'failed',
        message: '缺少飞书 App ID。',
        nextAction: '请在调用 feishu_connect 时传入 appId；App Secret 不需要在聊天中提供，应用配置会通过浏览器或飞书客户端完成。',
        errorCode: FEISHU_ERROR_CODES.APP_CREDENTIALS_MISSING,
        appId,
        domain,
      });
    }

    this.store.setRuntimeConfig({
      appId,
      appSecret,
      domain,
      preferredScopes: input.preferredScopes,
    });

    const cached = this.store.getConnectionStatus(appId);
    if (cached?.connected) {
      return cached;
    }

    const existingLogin = this.store.getActiveLogin(appId);
    if (existingLogin && (!existingLogin.timeoutAt || Date.now() <= existingLogin.timeoutAt)) {
      const status = buildPendingStatus({ appId, domain, login: existingLogin });
      this.store.updateConnectionStatus(appId, status);
      return status;
    }
    if (existingLogin) {
      this.store.setActiveLogin(appId, null);
    }

    const environment = await detectFeishuEnvironment(this.adapter);
    if (!environment.nodeAvailable || !environment.cliAvailable) {
      if (environment.failureReason === 'cli_missing' && environment.canAutoInstall) {
        const setupRequired = buildCliSetupRequiredStatus({
          appId,
          domain,
          message: '未检测到可用的 lark-cli，请先按官方流程安装飞书 CLI。',
          nextAction: '请调用 feishu_setup_cli 并传入 installCli=true、installSkill=true；安装完成后再次执行 feishu_connect。',
          errorCode: FEISHU_ERROR_CODES.CLI_UNAVAILABLE,
        });
        this.store.updateConnectionStatus(appId, setupRequired);
        return setupRequired;
      } else {
        const failure = toEnvironmentFailureStatus(environment, appId, domain);
        if (environment.failureReason === 'node_missing') {
          failure.nextAction = '请先安装 Node.js LTS，并确认 node 与 npx 命令可用；随后调用 feishu_setup_cli 安装飞书 CLI。';
        } else if (environment.failureReason === 'npx_missing') {
          failure.nextAction = '请修复当前 Node.js 安装，确保 npx 命令可用；随后调用 feishu_setup_cli 安装飞书 CLI。';
        }
        this.store.updateConnectionStatus(appId, failure);
        return failure;
      }
    }

    const currentStatus = await this.adapter.getAuthStatus(appId);
    const currentStatusOutput = `${currentStatus.stdout}\n${currentStatus.stderr}`.trim();
    if (currentStatus.code === 0 && isAuthorized(currentStatusOutput) && !isUnauthenticated(currentStatusOutput)) {
      const connected = buildConnectedStatus({ appId, domain, output: currentStatusOutput });
      this.store.updateConnectionStatus(appId, connected);
      return connected;
    }

    const configLines: string[] = [];
    const configResult = await this.adapter.initializeConfig((line) => {
      configLines.push(line);
    });
    const configOutput = `${configLines.join('\n')}\n${configResult.stdout}\n${configResult.stderr}`;
    const configUrl = parseAuthUrl(configOutput);
    if (configResult.code !== 0) {
      if (configUrl || /获取你的应用配置结果|扫码配置应用|complete setup/i.test(configOutput)) {
        const configLogin: FeishuPersistedLoginState = {
          id: 'lark-cli-config',
          step: 'config',
          state: 'config_pending',
          phase: 'config_pending',
          command: configResult.command,
          startedAt: Date.now(),
          timeoutAt: Date.now() + ACTIVE_LOGIN_TTL_MS,
          message: configUrl ? '应用配置流程已启动，请打开配置链接完成应用配置。' : '应用配置流程已启动，请在浏览器或飞书客户端完成配置。',
          nextAction: configUrl ? '打开 authUrl 完成应用配置；完成后再次执行 feishu_setup_cli 并传入 startLogin=true，或再次执行 feishu_connect 进入登录阶段。' : '请检查浏览器或飞书客户端中的配置确认页面；完成后再次执行 feishu_setup_cli 并传入 startLogin=true，或再次执行 feishu_connect。',
          authUrl: configUrl,
          outputLines: configLines,
        };
        this.store.setActiveLogin(appId, configLogin);
        const status = buildPendingStatus({ appId, domain, login: configLogin });
        this.store.updateConnectionStatus(appId, status);
        return status;
      }
      const normalized = normalizeFeishuCliError(configResult.stderr, configResult.stdout);
      const failure = toEnvironmentFailureStatus(environment, appId, domain);
      failure.message = normalized.message;
      failure.nextAction = normalized.nextAction || '请执行 lark-cli config init --new 完成初始化。';
      failure.errorCode = normalized.errorCode;
      this.store.updateConnectionStatus(appId, failure);
      return failure;
    }

    const outputLines: string[] = [];
    const login = await this.adapter.startLogin(
      {
        appId,
        appSecret: appSecret || '',
        domain,
        preferredScopes: input.preferredScopes,
        port: input.port,
        noWait: true,
        json: true,
      },
      (line) => {
        outputLines.push(line);
        appendLoginOutput({
          store: this.store,
          appId,
          line,
          message: '已发起授权，请在浏览器或飞书客户端完成确认。',
        });
      },
    );

    const activeLogin: FeishuPersistedLoginState = {
      id: login.id,
      step: 'login',
      state: 'approval_pending',
      phase: 'waiting_user_confirm',
      command: login.command,
      startedAt: Date.now(),
      timeoutAt: Date.now() + ACTIVE_LOGIN_TTL_MS,
      message: '已发起授权，请在浏览器或飞书客户端完成确认。',
      nextAction: '打开 authUrl 完成授权；完成后调用 feishu_auth_status 查询连接状态。',
      authUrl: parseAuthUrl(outputLines.join('\n')),
      deviceCode: parseDeviceCode(outputLines.join('\n')),
      outputLines,
    };
    this.store.setActiveLogin(appId, activeLogin);
    const initialRaw = await Promise.race([
      login.completion,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 300)),
    ]);
    if (initialRaw) {
      const initialOutput = `${initialRaw.stdout}\n${initialRaw.stderr}`;
      const initialAuthUrl = parseAuthUrl(initialOutput);
      const initialDeviceCode = parseDeviceCode(initialOutput);
      if (initialRaw.code === 0 && (initialAuthUrl || initialDeviceCode || /no-wait|verification|authorize/i.test(initialOutput))) {
        const pendingLogin: FeishuPersistedLoginState = {
          ...activeLogin,
          authUrl: activeLogin.authUrl || initialAuthUrl,
          deviceCode: activeLogin.deviceCode || initialDeviceCode,
          outputLines: [...activeLogin.outputLines, initialOutput].filter(Boolean).slice(-100),
          message: initialAuthUrl ? '授权已发起，请打开授权链接完成确认。' : '授权流程已启动，请在飞书客户端或浏览器完成确认。',
        };
        this.store.setActiveLogin(appId, pendingLogin);
        const status = buildPendingStatus({ appId, domain, login: pendingLogin });
        this.store.updateConnectionStatus(appId, status);
        return status;
      }
      if (initialRaw.code === 0) {
        const connected = buildConnectedStatus({ appId, domain, output: initialOutput, authUrl: initialAuthUrl });
        this.store.updateConnectionStatus(appId, connected);
        this.store.setActiveLogin(appId, null);
        return connected;
      }
      if (initialAuthUrl || initialDeviceCode) {
        const pendingLogin: FeishuPersistedLoginState = {
          ...activeLogin,
          authUrl: activeLogin.authUrl || initialAuthUrl,
          deviceCode: activeLogin.deviceCode || initialDeviceCode,
          outputLines: [...activeLogin.outputLines, initialOutput].filter(Boolean).slice(-100),
          message: initialAuthUrl ? '授权链接已生成，请手动打开 authUrl 完成确认。' : '授权流程已启动，请按 CLI 提示完成设备码确认。',
          nextAction: initialAuthUrl ? '复制并打开 authUrl；完成后调用 feishu_auth_status 查询连接状态。' : '根据 deviceCode 完成确认；完成后调用 feishu_auth_status 查询连接状态。',
        };
        this.store.setActiveLogin(appId, pendingLogin);
        const status = buildPendingStatus({ appId, domain, login: pendingLogin });
        this.store.updateConnectionStatus(appId, status);
        return status;
      }
      const normalized = normalizeFeishuCliError(initialRaw.stderr, initialRaw.stdout);
      const failed = buildStatus({
        success: false,
        connected: false,
        state: normalized.errorCode === FEISHU_ERROR_CODES.AUTH_EXPIRED ? 'auth_expired' : 'unauthorized',
        phase: normalized.errorCode === FEISHU_ERROR_CODES.AUTH_EXPIRED ? 'auth_expired' : 'failed',
        message: normalized.message,
        nextAction: normalized.nextAction,
        errorCode: normalized.errorCode,
        appId,
        domain,
        authUrl: initialAuthUrl,
      });
      this.store.updateConnectionStatus(appId, failed);
      this.store.setActiveLogin(appId, null);
      return failed;
    }

    const storedLogin = this.store.getActiveLogin(appId);

    const pendingStatus = buildPendingStatus({ appId, domain, login: storedLogin || activeLogin });
    this.store.updateConnectionStatus(appId, pendingStatus);

    if (storedLogin?.authUrl) {
      return pendingStatus;
    }

    const waitForMs = input.waitForMs ?? DEFAULT_CONNECT_WAIT_MS;
    const raw = waitForMs <= 300 ? null : await Promise.race([
      login.completion,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), waitForMs - 300)),
    ]);

    if (raw === null) {
      const latest = this.store.getActiveLogin(appId) || activeLogin;
      latest.message = latest.authUrl ? '授权已发起，请打开授权链接完成确认。' : '授权流程已启动，正在等待 CLI 输出授权链接。';
      latest.nextAction = latest.authUrl ? '打开 authUrl 完成授权；完成后调用 feishu_auth_status 查询连接状态。' : '稍后调用 feishu_auth_status 查询授权链接或连接状态。';
      this.store.setActiveLogin(appId, latest);
      const status = buildPendingStatus({ appId, domain, login: latest });
      this.store.updateConnectionStatus(appId, status);
      return status;
    }

    const mergedOutput = `${raw.stdout}\n${raw.stderr}`;
    const rawAuthUrl = parseAuthUrl(mergedOutput) || this.store.getActiveLogin(appId)?.authUrl;
    const rawDeviceCode = parseDeviceCode(mergedOutput) || this.store.getActiveLogin(appId)?.deviceCode;
    if (raw.code !== 0) {
      if (rawAuthUrl || rawDeviceCode) {
        const pendingLogin: FeishuPersistedLoginState = {
          ...(this.store.getActiveLogin(appId) || activeLogin),
          state: 'approval_pending',
          phase: 'waiting_user_confirm',
          message: rawAuthUrl ? '授权链接已生成，请手动打开 authUrl 完成确认。' : '授权流程已启动，请按 CLI 提示完成设备码确认。',
          nextAction: rawAuthUrl ? '复制并打开 authUrl；完成后调用 feishu_auth_status 查询连接状态。' : '根据 deviceCode 完成确认；完成后调用 feishu_auth_status 查询连接状态。',
          authUrl: rawAuthUrl,
          deviceCode: rawDeviceCode,
          outputLines: [...(this.store.getActiveLogin(appId)?.outputLines || activeLogin.outputLines), mergedOutput].filter(Boolean).slice(-100),
        };
        this.store.setActiveLogin(appId, pendingLogin);
        const status = buildPendingStatus({ appId, domain, login: pendingLogin });
        this.store.updateConnectionStatus(appId, status);
        return status;
      }
      const normalized = normalizeFeishuCliError(raw.stderr, raw.stdout);
      const failed = buildStatus({
        success: false,
        connected: false,
        state: normalized.errorCode === FEISHU_ERROR_CODES.AUTH_EXPIRED ? 'auth_expired' : 'unauthorized',
        phase: normalized.errorCode === FEISHU_ERROR_CODES.AUTH_EXPIRED ? 'auth_expired' : 'failed',
        message: normalized.message,
        nextAction: normalized.nextAction,
        errorCode: normalized.errorCode,
        appId,
        domain,
        authUrl: rawAuthUrl,
      });
      this.store.updateConnectionStatus(appId, failed);
      this.store.setActiveLogin(appId, null);
      return failed;
    }

    const connected = buildConnectedStatus({ appId, domain, output: mergedOutput, authUrl: rawAuthUrl });
    this.store.updateConnectionStatus(appId, connected);
    this.store.setActiveLogin(appId, null);
    return connected;
  }

  async pollLoginStatus(input?: Pick<FeishuConnectInput, 'appId' | 'domain'>): Promise<FeishuConnectionStatus> {
    const cached = this.store.getConnectionStatus(input?.appId);
    if (cached?.connected) {
      return cached;
    }

    const activeLogin = this.store.getActiveLogin(input?.appId);
    if (!activeLogin) {
      return await this.checkAuthStatus(input);
    }

    if (activeLogin.timeoutAt && Date.now() > activeLogin.timeoutAt) {
      const expired = buildStatus({
        success: false,
        connected: false,
        state: 'auth_expired',
        phase: 'auth_expired',
        message: '授权流程已超时，请重新发起连接。',
        nextAction: '请重新执行 feishu_connect。',
        errorCode: FEISHU_ERROR_CODES.AUTH_TIMEOUT,
        appId: input?.appId,
        domain: input?.domain || DEFAULT_DOMAIN,
        authUrl: activeLogin.authUrl,
      });
      this.store.updateConnectionStatus(input?.appId, expired);
      this.store.setActiveLogin(input?.appId, null);
      return expired;
    }

    const output = activeLogin.outputLines.join('\n');
    if (isExpired(output)) {
      const expired = buildStatus({
        success: false,
        connected: false,
        state: 'auth_expired',
        phase: 'auth_expired',
        message: '当前授权已过期，请重新发起连接。',
        nextAction: '请重新执行 feishu_connect。',
        errorCode: FEISHU_ERROR_CODES.AUTH_EXPIRED,
        appId: input?.appId,
        domain: input?.domain || DEFAULT_DOMAIN,
        authUrl: activeLogin.authUrl,
      });
      this.store.updateConnectionStatus(input?.appId, expired);
      this.store.setActiveLogin(input?.appId, null);
      return expired;
    }

    if (activeLogin.step === 'config') {
      const status = buildPendingStatus({
        appId: input?.appId,
        domain: input?.domain,
        login: activeLogin,
      });
      this.store.updateConnectionStatus(input?.appId, status);
      return status;
    }

    const statusRaw = await this.adapter.getAuthStatus(input?.appId);
    const merged = `${statusRaw.stdout}\n${statusRaw.stderr}`.trim();
    if (statusRaw.code === 0 && isAuthorized(merged) && !isUnauthenticated(merged)) {
      const connected = buildConnectedStatus({
        appId: input?.appId,
        domain: input?.domain || DEFAULT_DOMAIN,
        output: merged,
        authUrl: activeLogin.authUrl,
      });
      this.store.updateConnectionStatus(input?.appId, connected);
      this.store.setActiveLogin(input?.appId, null);
      return connected;
    }

    if (isApprovalPending(merged) || /device authorization/i.test(merged)) {
      const pending = buildPendingStatus({
        appId: input?.appId,
        domain: input?.domain,
        login: {
          ...activeLogin,
          state: 'approval_pending',
          phase: 'approval_pending',
          message: '授权已发起，当前仍在等待用户确认或审批。',
          nextAction: '请在飞书侧完成确认，然后稍后重试。',
        },
      });
      this.store.updateConnectionStatus(input?.appId, pending);
      return pending;
    }

    if (isApprovalPending(output)) {
      const pending = buildPendingStatus({
        appId: input?.appId,
        domain: input?.domain,
        login: {
          ...activeLogin,
          state: 'approval_pending',
          phase: 'approval_pending',
          message: '授权已发起，当前仍在等待用户确认或审批。',
          nextAction: '请在飞书侧完成确认，然后稍后重试。',
        },
      });
      this.store.updateConnectionStatus(input?.appId, pending);
      return pending;
    }

    if (statusRaw.code !== 0 && merged) {
      const normalized = normalizeFeishuCliError(statusRaw.stderr, statusRaw.stdout);
      const failed = buildStatus({
        success: false,
        connected: false,
        state: normalized.errorCode === FEISHU_ERROR_CODES.AUTH_EXPIRED ? 'auth_expired' : 'unauthorized',
        phase: normalized.errorCode === FEISHU_ERROR_CODES.AUTH_EXPIRED ? 'auth_expired' : 'failed',
        message: normalized.message,
        nextAction: normalized.nextAction,
        errorCode: normalized.errorCode,
        appId: input?.appId,
        domain: input?.domain || DEFAULT_DOMAIN,
        authUrl: activeLogin.authUrl,
      });
      this.store.updateConnectionStatus(input?.appId, failed);
      if (normalized.errorCode !== FEISHU_ERROR_CODES.AUTH_PENDING) {
        this.store.setActiveLogin(input?.appId, null);
      }
      return failed;
    }

    const pending = buildPendingStatus({
      appId: input?.appId,
      domain: input?.domain,
      login: activeLogin,
    });
    this.store.updateConnectionStatus(input?.appId, pending);
    return pending;
  }

  async disconnect(input?: Pick<FeishuConnectInput, 'appId' | 'domain'>): Promise<FeishuConnectionStatus> {
    const appId = input?.appId?.trim();
    const domain = input?.domain?.trim() || DEFAULT_DOMAIN;

    if (appId) {
      try {
        await this.adapter.logout(appId);
      } catch {
        // Keep disconnect idempotent even if CLI cleanup fails.
      }
    }

    this.store.clear(appId);
    return buildStatus({
      success: true,
      connected: false,
      state: 'unauthorized',
      phase: 'idle',
      message: '已断开当前飞书连接。',
      nextAction: '如需继续使用，请重新执行 feishu_connect。',
      appId,
      domain,
      account: null,
      tenant: null,
    });
  }
}

export const feishuAuthService = new FeishuAuthService();
