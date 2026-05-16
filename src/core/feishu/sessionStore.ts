import type { FeishuConnectionStatus, FeishuPersistedLoginState, FeishuPersistedSession } from './types';

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

  setActiveLogin(appId: string | undefined, login: FeishuPersistedLoginState | null): void {
    const current = this.getSession(appId);
    current.activeLogin = login ? JSON.parse(JSON.stringify(login)) as FeishuPersistedLoginState : null;
    this.setSession(appId, current);
  }

  getActiveLogin(appId?: string): FeishuPersistedLoginState | null {
    return this.getSession(appId).activeLogin ?? null;
  }

  clear(appId?: string): void {
    memoryStore.delete(normalizeAppId(appId));
  }
}

export const feishuSessionStore = new FeishuSessionStore();
