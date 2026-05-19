import type {
  FeishuBaseSummary,
  FeishuFieldSchema,
  FeishuPagedResult,
  FeishuRecordQueryResult,
  FeishuTableSummary,
} from './types';

export class FeishuResultNormalizer {
  asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  pickBoolean(source: Record<string, unknown>, keys: string[]): boolean | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'boolean') {
        return value;
      }
    }
    return undefined;
  }

  pickNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number') {
        return value;
      }
    }
    return undefined;
  }

  private pickResponseCode(source: Record<string, unknown>): number | undefined {
    const value = source.code;
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private pickErrorMessage(source: Record<string, unknown>): string {
    const direct = this.pickString(source, ['msg', 'message', 'error_msg', 'errorMessage', 'error_description']);
    if (direct) return direct;

    const nestedError = this.asObject(source.error);
    return this.pickString(nestedError, ['msg', 'message', 'description', 'error_msg'])
      || '飞书请求失败';
  }

  private assertApiSuccess(source: Record<string, unknown>): void {
    const code = this.pickResponseCode(source);
    if (code !== undefined && code !== 0) {
      throw new Error(`飞书请求失败(${code}): ${this.pickErrorMessage(source)}`);
    }
  }

  parseJsonPayload(raw: string): unknown {
    const trimmed = raw.trim();
    if (!trimmed) return {};

    try {
      return JSON.parse(trimmed);
    } catch {
      const arrayStart = trimmed.indexOf('[');
      const objectStart = trimmed.indexOf('{');
      const start = arrayStart === -1 ? objectStart : objectStart === -1 ? arrayStart : Math.min(arrayStart, objectStart);
      const end = Math.max(trimmed.lastIndexOf(']'), trimmed.lastIndexOf('}'));
      if (start >= 0 && end > start) {
        return JSON.parse(trimmed.slice(start, end + 1));
      }
      throw new Error(`无法解析飞书返回结果: ${trimmed}`);
    }
  }

  unwrapData(payload: unknown): Record<string, unknown> {
    const objectPayload = this.asObject(payload);
    this.assertApiSuccess(objectPayload);

    const nested = this.asObject(objectPayload.data);
    if (Object.keys(nested).length > 0) {
      this.assertApiSuccess(nested);
      return nested;
    }

    return objectPayload;
  }

  extractItems(container: Record<string, unknown>): unknown[] {
    const candidates = [
      container.items,
      container.files,
      container.records,
      container.tables,
      container.fields,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }

    return [];
  }

  toPagedResult<T>(payload: unknown, mapper: (item: Record<string, unknown>) => T | null): FeishuPagedResult<T> {
    const data = this.unwrapData(payload);
    const items = this.extractItems(data)
      .map((item) => mapper(this.asObject(item)))
      .filter((item): item is T => item !== null);

    return {
      items,
      pageToken: this.pickString(data, ['page_token', 'pageToken', 'next_page_token']) ?? null,
      hasMore: this.pickBoolean(data, ['has_more', 'hasMore']) ?? false,
      total: this.pickNumber(data, ['total', 'total_count']),
    };
  }

  normalizeBase(item: Record<string, unknown>): FeishuBaseSummary | null {
    const type = this.pickString(item, ['type', 'file_type', 'obj_type']);
    const id = this.pickString(item, ['app_token', 'appToken', 'token', 'file_token']);
    if (!id) return null;
    if (type && type !== 'bitable') return null;

    return {
      id,
      name: this.pickString(item, ['name', 'title']) || id,
      url: this.pickString(item, ['url', 'open_url', 'link']),
    };
  }

  normalizeTable(baseId: string, item: Record<string, unknown>): FeishuTableSummary | null {
    const id = this.pickString(item, ['table_id', 'tableId', 'id']);
    if (!id) return null;
    return {
      id,
      name: this.pickString(item, ['name']) || id,
      baseId,
    };
  }

  normalizeField(item: Record<string, unknown>): FeishuFieldSchema | null {
    const fieldId = this.pickString(item, ['field_id', 'fieldId', 'id']);
    const fieldName = this.pickString(item, ['field_name', 'fieldName', 'name']);
    if (!fieldId || !fieldName) return null;

    const property = this.asObject(item.property);
    const options = this.asArray(property.options)
      .map((option) => this.pickString(this.asObject(option), ['name']))
      .filter(Boolean) as string[];

    return {
      fieldId,
      fieldName,
      fieldType: this.pickString(item, ['type', 'ui_type']) || 'unknown',
      writable: this.pickBoolean(item, ['is_writable', 'writable']) ?? !item.is_primary,
      required: this.pickBoolean(item, ['required', 'is_required']),
      options: options.length > 0 ? options : undefined,
    };
  }

  normalizeRecord(item: Record<string, unknown>): Record<string, unknown> {
    const fields = this.asObject(item.fields);
    const recordId = this.pickString(item, ['record_id', 'recordId', 'id']);
    return recordId ? { recordId, ...fields } : fields;
  }

  normalizeRecordEnvelope(item: Record<string, unknown>): { recordId?: string; fields: Record<string, unknown> } {
    return {
      recordId: this.pickString(item, ['record_id', 'recordId', 'id']),
      fields: this.asObject(item.fields),
    };
  }

  normalizeRecordQueryResult(payload: unknown): FeishuRecordQueryResult {
    const data = this.unwrapData(payload);
    return {
      records: this.extractItems(data).map((item) => this.normalizeRecord(this.asObject(item))),
      pageToken: this.pickString(data, ['page_token', 'pageToken', 'next_page_token']) ?? null,
      hasMore: this.pickBoolean(data, ['has_more', 'hasMore']) ?? false,
      total: this.pickNumber(data, ['total', 'total_count']),
    };
  }

  extractWriteSuccessCount(payload: unknown, fallback: number): number {
    const data = this.unwrapData(payload);
    const explicitTotal = this.pickNumber(data, ['total', 'success_count', 'updated_count', 'created_count']);
    if (typeof explicitTotal === 'number') {
      return explicitTotal;
    }

    const itemsCount = this.extractItems(data).length;
    return itemsCount > 0 ? itemsCount : fallback;
  }
}

export const feishuResultNormalizer = new FeishuResultNormalizer();
