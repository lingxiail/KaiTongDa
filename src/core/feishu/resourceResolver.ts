import { FeishuBaseService, feishuBaseService } from './baseService';
import { FeishuSessionStore, feishuSessionStore } from './sessionStore';
import type { FeishuBaseSummary, FeishuFieldSchema, FeishuTableSummary } from './types';
import type { FeishuResolvedBase, FeishuResolvedTable, FeishuResourceCandidate } from './intentTypes';

function normalizeName(value?: string): string {
  return value?.trim().toLowerCase() || '';
}

function toBaseCandidate(item: FeishuBaseSummary): FeishuResourceCandidate {
  return {
    id: item.id,
    name: item.name,
    type: 'base',
  };
}

function toTableCandidate(item: FeishuTableSummary): FeishuResourceCandidate {
  return {
    id: item.id,
    name: item.name,
    type: 'table',
    baseId: item.baseId,
  };
}

function rankByName<T extends { name: string }>(items: T[], targetName: string): T[] {
  const normalizedTarget = normalizeName(targetName);
  const exact = items.filter((item) => normalizeName(item.name) === normalizedTarget);
  if (exact.length > 0) return exact;
  return items.filter((item) => normalizeName(item.name).includes(normalizedTarget));
}

export interface ResolveBaseInput {
  appId?: string;
  baseId?: string;
  baseName?: string;
}

export interface ResolveTableInput extends ResolveBaseInput {
  tableId?: string;
  tableName?: string;
}

export interface FeishuResolutionResult<T> {
  resolved?: T;
  candidates?: FeishuResourceCandidate[];
}

export class FeishuResourceResolver {
  private readonly baseService: FeishuBaseService;
  private readonly store: FeishuSessionStore;

  constructor(
    baseService: FeishuBaseService = feishuBaseService,
    store: FeishuSessionStore = feishuSessionStore,
  ) {
    this.baseService = baseService;
    this.store = store;
  }

  private async getBases(appId?: string): Promise<FeishuBaseSummary[]> {
    const cached = this.store.getCachedBases(appId);
    if (cached?.items?.length) {
      return cached.items;
    }
    return (await this.baseService.listBases({ appId })).items;
  }

  private async getTables(appId: string | undefined, baseId: string): Promise<FeishuTableSummary[]> {
    const cached = this.store.getCachedTables(appId, baseId);
    if (cached?.items?.length) {
      return cached.items;
    }
    return (await this.baseService.listTables({ appId, baseId })).items;
  }

  private async getSchema(appId: string | undefined, baseId: string, tableId: string): Promise<FeishuFieldSchema[]> {
    const cached = this.store.getCachedSchema(appId, baseId, tableId);
    if (cached?.items?.length) {
      return cached.items;
    }
    return (await this.baseService.getTableSchema({ appId, baseId, tableId })).items;
  }

  async resolveBase(input: ResolveBaseInput): Promise<FeishuResolutionResult<FeishuResolvedBase>> {
    const recent = this.store.getRecentContext(input.appId);
    const baseId = input.baseId?.trim() || recent?.baseId;
    const baseName = input.baseName?.trim() || recent?.baseName;

    if (baseId) {
      const bases = await this.getBases(input.appId);
      const matched = bases.find((item) => item.id === baseId);
      return {
        resolved: {
          id: baseId,
          name: matched?.name || baseName || baseId,
        },
      };
    }

    if (!baseName) {
      return {};
    }

    const bases = await this.getBases(input.appId);
    const matched = rankByName(bases, baseName);
    if (matched.length === 1) {
      return {
        resolved: {
          id: matched[0].id,
          name: matched[0].name,
        },
      };
    }

    if (matched.length > 1) {
      return { candidates: matched.map(toBaseCandidate) };
    }

    return {};
  }

  async resolveTable(input: ResolveTableInput): Promise<FeishuResolutionResult<FeishuResolvedTable> & { base?: FeishuResolvedBase }> {
    const recent = this.store.getRecentContext(input.appId);
    const baseResolution = await this.resolveBase({
      appId: input.appId,
      baseId: input.baseId,
      baseName: input.baseName,
    });
    const base = baseResolution.resolved;
    const tableId = input.tableId?.trim() || recent?.tableId;
    const tableName = input.tableName?.trim() || recent?.tableName;

    if (tableId) {
      return {
        base,
        resolved: {
          id: tableId,
          name: tableName || tableId,
          baseId: base?.id || recent?.baseId || '',
        },
        candidates: baseResolution.candidates,
      };
    }

    if (!base) {
      return { candidates: baseResolution.candidates };
    }

    if (!tableName) {
      return { base };
    }

    const tables = await this.getTables(input.appId, base.id);
    const matched = rankByName(tables, tableName);
    if (matched.length === 1) {
      return {
        base,
        resolved: {
          id: matched[0].id,
          name: matched[0].name,
          baseId: matched[0].baseId,
        },
      };
    }

    if (matched.length > 1) {
      return {
        base,
        candidates: matched.map(toTableCandidate),
      };
    }

    return { base };
  }

  async getFieldSchemas(appId: string | undefined, baseId: string, tableId: string): Promise<FeishuFieldSchema[]> {
    return await this.getSchema(appId, baseId, tableId);
  }
}

export const feishuResourceResolver = new FeishuResourceResolver();
