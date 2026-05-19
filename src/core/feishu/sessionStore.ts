import type {
  FeishuConnectionStatus,
  FeishuFieldSchema,
  FeishuPagedResult,
  FeishuBaseSummary,
  FeishuPersistedLoginState,
  FeishuRecentContext,
  FeishuPersistedSession,
  FeishuTableSummary,
} from './types';

const memoryStore = new Map<string, FeishuPersistedSession>();

function normalizeAppId(appId?: string): string {
  return appId?.trim() || '__default__';
}

function cloneSession(session?: FeishuPersistedSession | null): FeishuPersistedSession {
  return session
    ? JSON.parse(JSON.stringify(session)) as FeishuPersistedSession
    : {};
}

export class FeishuSessionStore {
  getSession(appId?: string): FeishuPersistedSession {
    return cloneSession(memoryStore.get(normalizeAppId(appId)));
  }

  setSession(appId: string | undefined, session: FeishuPersistedSession): void {
    memoryStore.set(normalizeAppId(appId), cloneSession(session));
  }

  updateConnectionStatus(appId: string | undefined, status: FeishuConnectionStatus | null): void {
    const current = this.getSession(appId);
    current.connection = status ? JSON.parse(JSON.stringify(status)) as FeishuConnectionStatus : null;
    this.setSession(appId, current);
  }

  getConnectionStatus(appId?: string): FeishuConnectionStatus | null {
    return this.getSession(appId).connection ?? null;
  }

  setRuntimeConfig(input: {
    appId?: string;
    appSecret?: string;
    domain?: string;
    preferredScopes?: string[];
  }): void {
    const current = this.getSession(input.appId);
    current.appId = input.appId?.trim() || current.appId;
    current.appSecret = input.appSecret?.trim() || current.appSecret;
    current.domain = input.domain?.trim() || current.domain;
    current.preferredScopes = input.preferredScopes ? [...input.preferredScopes] : current.preferredScopes;
    this.setSession(input.appId, current);
  }

  getRuntimeConfig(appId?: string): Pick<FeishuPersistedSession, 'appId' | 'appSecret' | 'domain' | 'preferredScopes'> {
    const session = this.getSession(appId);
    return {
      appId: session.appId,
      appSecret: session.appSecret,
      domain: session.domain,
      preferredScopes: session.preferredScopes ? [...session.preferredScopes] : undefined,
    };
  }

  setActiveLogin(appId: string | undefined, login: FeishuPersistedLoginState | null): void {
    const current = this.getSession(appId);
    current.activeLogin = login ? JSON.parse(JSON.stringify(login)) as FeishuPersistedLoginState : null;
    this.setSession(appId, current);
  }

  getActiveLogin(appId?: string): FeishuPersistedLoginState | null {
    return this.getSession(appId).activeLogin ?? null;
  }

  setCachedBases(appId: string | undefined, result: FeishuPagedResult<FeishuBaseSummary> | null): void {
    const current = this.getSession(appId);
    current.cachedBases = result ? JSON.parse(JSON.stringify(result)) as FeishuPagedResult<FeishuBaseSummary> : null;
    this.setSession(appId, current);
  }

  getCachedBases(appId?: string): FeishuPagedResult<FeishuBaseSummary> | null {
    return this.getSession(appId).cachedBases ?? null;
  }

  setCachedTables(appId: string | undefined, baseId: string, result: FeishuPagedResult<FeishuTableSummary> | null): void {
    const current = this.getSession(appId);
    current.cachedTables ||= {};
    if (result) {
      current.cachedTables[baseId] = JSON.parse(JSON.stringify(result)) as FeishuPagedResult<FeishuTableSummary>;
    } else {
      delete current.cachedTables[baseId];
    }
    this.setSession(appId, current);
  }

  getCachedTables(appId: string | undefined, baseId: string): FeishuPagedResult<FeishuTableSummary> | null {
    return this.getSession(appId).cachedTables?.[baseId] ?? null;
  }

  setCachedSchema(
    appId: string | undefined,
    baseId: string,
    tableId: string,
    result: FeishuPagedResult<FeishuFieldSchema> | null,
  ): void {
    const current = this.getSession(appId);
    current.cachedSchemas ||= {};
    const cacheKey = `${baseId}:${tableId}`;
    if (result) {
      current.cachedSchemas[cacheKey] = JSON.parse(JSON.stringify(result)) as FeishuPagedResult<FeishuFieldSchema>;
    } else {
      delete current.cachedSchemas[cacheKey];
    }
    this.setSession(appId, current);
  }

  getCachedSchema(appId: string | undefined, baseId: string, tableId: string): FeishuPagedResult<FeishuFieldSchema> | null {
    return this.getSession(appId).cachedSchemas?.[`${baseId}:${tableId}`] ?? null;
  }

  setRecentContext(appId: string | undefined, context: FeishuRecentContext | null): void {
    const current = this.getSession(appId);
    current.recentContext = context ? JSON.parse(JSON.stringify(context)) as FeishuRecentContext : null;
    this.setSession(appId, current);
  }

  getRecentContext(appId?: string): FeishuRecentContext | null {
    return this.getSession(appId).recentContext ?? null;
  }

  mergeRecentContext(appId: string | undefined, context: Partial<FeishuRecentContext>): FeishuRecentContext {
    const merged: FeishuRecentContext = {
      ...(this.getRecentContext(appId) ?? {}),
      ...context,
      updatedAt: context.updatedAt ?? Date.now(),
    };
    this.setRecentContext(appId, merged);
    return merged;
  }

  clear(appId?: string): void {
    memoryStore.delete(normalizeAppId(appId));
  }
}

export const feishuSessionStore = new FeishuSessionStore();
