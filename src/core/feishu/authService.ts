import { FEISHU_ERROR_CODES } from './errorCodes';
import type { FeishuCliAdapter } from './cliAdapter';
import { feishuCliAdapter } from './cliAdapter';
import { detectFeishuEnvironment, toEnvironmentFailureStatus } from './env';
import { normalizeFeishuCliError } from './errorNormalizer';
import type {
  FeishuAccountSummary,
  FeishuConnectInput,
  FeishuConnectionStatus,
  FeishuPersistedLoginState,
  FeishuTenantSummary,
} from './types';
import { FeishuSessionStore, feishuSessionStore } from './sessionStore';

const DEFAULT_DOMAIN = 'https://open.feishu.cn';
const DEFAULT_CONNECT_WAIT_MS = 10000;

function parseAuthUrl(output: string): string | undefined {
  const match = output.match(/https?:\/\/[^\s"'`]+/i);
  return match?.[0];
}

function parseAccountSummary(output: string): { account: FeishuAccountSummary | null; tenant: FeishuTenantSummary | null } {
  const account: FeishuAccountSummary = {};
  const tenant: FeishuTenantSummary = {};

  const name = output.match(/(?:^|\b)(?:name|user_name)\s*[:=]\s*([^\r\n]+)/im)?.[1]?.trim();
  const email = output.match(/(?:^|\b)email\s*[:=]\s*([^\r\n]+)/im)?.[1]?.trim();
  const userId = output.match(/(?:^|\b)(?:user_id|open_id)\s*[:=]\s*([^\r\n]+)/im)?.[1]?.trim();
  const tenantKey = output.match(/(?:^|\b)tenant(?:_key)?\s*[:=]\s*([^\r\n]+)/im)?.[1]?.trim();

  if (name) account.name = name;
  if (email) account.email = email;
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

export class FeishuAuthService {
  constructor(
    private readonly adapter: FeishuCliAdapter = feishuCliAdapter,
    private readonly store: FeishuSessionStore = feishuSessionStore,
  ) {}

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

      return buildStatus({
        success: false,
        connected: false,
        state: activeLogin.state,
        phase: activeLogin.phase,
        message: activeLogin.message || '授权进行中，请完成浏览器或飞书客户端确认。',
        nextAction: activeLogin.nextAction || '继续等待授权完成，或重新发起连接。',
        appId: input?.appId,
        domain: input?.domain || DEFAULT_DOMAIN,
        authUrl: activeLogin.authUrl,
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
    const domain = input.domain?.trim() || DEFAULT_DOMAIN;

    if (!appId || !appSecret) {
      return buildStatus({
        success: false,
        connected: false,
        state: 'unauthorized',
        phase: 'failed',
        message: '缺少飞书 App ID 或 App Secret。',
        nextAction: '请在调用 feishu_connect 时传入 appId 和 appSecret。',
        errorCode: FEISHU_ERROR_CODES.APP_CREDENTIALS_MISSING,
        appId,
        domain,
      });
    }

    const environment = await detectFeishuEnvironment(this.adapter);
    if (!environment.nodeAvailable || !environment.cliAvailable) {
      const failure = toEnvironmentFailureStatus(environment, appId, domain);
      this.store.updateConnectionStatus(appId, failure);
      return failure;
    }

    const outputLines: string[] = [];
    const login = await this.adapter.startLogin(
      {
        appId,
        appSecret,
        domain,
        preferredScopes: input.preferredScopes,
        port: input.port,
      },
      (line) => {
        outputLines.push(line);
        const activeLogin = this.store.getActiveLogin(appId);
        if (!activeLogin) return;
        activeLogin.outputLines = [...activeLogin.outputLines, line].slice(-100);
        activeLogin.authUrl = activeLogin.authUrl || parseAuthUrl(line);
        activeLogin.message = '已发起授权，请在浏览器或飞书客户端完成确认。';
        this.store.setActiveLogin(appId, activeLogin);
      },
    );

    const activeLogin: FeishuPersistedLoginState = {
      id: login.id,
      state: 'approval_pending',
      phase: 'waiting_user_confirm',
      startedAt: Date.now(),
      timeoutAt: Date.now() + (input.waitForMs ?? DEFAULT_CONNECT_WAIT_MS) + 240000,
      message: '已发起授权，请在浏览器或飞书客户端完成确认。',
      nextAction: '完成确认后可再次查询状态，或继续等待本次连接结果。',
      authUrl: parseAuthUrl(outputLines.join('\n')),
      outputLines,
    };
    this.store.setActiveLogin(appId, activeLogin);
    const storedLogin = this.store.getActiveLogin(appId);

    const pendingStatus = buildStatus({
      success: false,
      connected: false,
      state: 'approval_pending',
      phase: 'waiting_user_confirm',
      message: activeLogin.message,
      nextAction: activeLogin.nextAction,
      appId,
      domain,
      authUrl: storedLogin?.authUrl,
    });
    this.store.updateConnectionStatus(appId, pendingStatus);

    const waitForMs = input.waitForMs ?? DEFAULT_CONNECT_WAIT_MS;
    const raw = await Promise.race([
      login.completion,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), waitForMs)),
    ]);

    if (raw === null) {
      return buildStatus({
        ...pendingStatus,
        message: '授权已发起，正在等待用户确认。',
        nextAction: '可稍后再次调用 feishu_auth_status 查看进度。',
        authUrl: this.store.getActiveLogin(appId)?.authUrl,
        lastUpdatedAt: Date.now(),
      });
    }

    const mergedOutput = `${raw.stdout}\n${raw.stderr}`;
    if (raw.code !== 0) {
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
        authUrl: parseAuthUrl(mergedOutput),
      });
      this.store.updateConnectionStatus(appId, failed);
      this.store.setActiveLogin(appId, null);
      return failed;
    }

    const parsed = parseAccountSummary(mergedOutput);
    const connected = buildStatus({
      success: true,
      connected: true,
      state: 'connected',
      phase: 'connected',
      message: '飞书连接成功。',
      nextAction: '可继续查询授权状态或进入下一阶段能力开发。',
      appId,
      domain,
      account: parsed.account,
      tenant: parsed.tenant,
      authUrl: parseAuthUrl(mergedOutput),
    });
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

    if (isApprovalPending(output)) {
      return buildStatus({
        success: false,
        connected: false,
        state: 'approval_pending',
        phase: 'approval_pending',
        message: '授权已发起，当前仍在等待用户确认或审批。',
        nextAction: '请在飞书侧完成确认，然后稍后重试。',
        errorCode: FEISHU_ERROR_CODES.AUTH_PENDING,
        appId: input?.appId,
        domain: input?.domain || DEFAULT_DOMAIN,
        authUrl: activeLogin.authUrl,
      });
    }

    return await this.checkAuthStatus(input);
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
