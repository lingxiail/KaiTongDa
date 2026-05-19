import { FEISHU_ERROR_CODES } from './errorCodes';
import type { FeishuFieldSchema } from './types';

function normalizeFieldType(fieldType: string): string {
  return fieldType.replace(/[\s_-]+/g, '').toLowerCase();
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSupportedPrimitiveType(fieldType: string): boolean {
  const normalized = normalizeFieldType(fieldType);
  return [
    'text',
    'number',
    'currency',
    'checkbox',
    'bool',
    'boolean',
    'date',
    'datetime',
    'url',
    'email',
    'phone',
  ].includes(normalized);
}

function isValueCompatible(fieldType: string, value: unknown): boolean {
  const normalized = normalizeFieldType(fieldType);
  if (value === null || value === undefined) return true;

  if (['text', 'url', 'email', 'phone'].includes(normalized)) {
    return typeof value === 'string';
  }
  if (['number', 'currency'].includes(normalized)) {
    return typeof value === 'number';
  }
  if (['checkbox', 'bool', 'boolean'].includes(normalized)) {
    return typeof value === 'boolean';
  }
  if (['date', 'datetime'].includes(normalized)) {
    return typeof value === 'string' || typeof value === 'number' || value instanceof Date;
  }

  return !isObjectLike(value) && !Array.isArray(value);
}

export class FeishuFieldMapper {
  validateRecords(schema: FeishuFieldSchema[], records: Array<Record<string, unknown>>): void {
    records.forEach((record, index) => this.validateFields(schema, record, `第 ${index + 1} 条记录`));
  }

  validateFields(schema: FeishuFieldSchema[], fields: Record<string, unknown>, scope = '写入字段'): void {
    const schemaByName = new Map(schema.map((item) => [item.fieldName, item]));
    for (const [fieldName, value] of Object.entries(fields)) {
      const matchedField = schemaByName.get(fieldName);
      if (!matchedField) {
        throw new Error(`${FEISHU_ERROR_CODES.FIELD_MISMATCH}: ${scope}中的字段「${fieldName}」不存在。`);
      }
      if (!matchedField.writable) {
        throw new Error(`${FEISHU_ERROR_CODES.FIELD_MISMATCH}: 字段「${fieldName}」当前不可写。`);
      }
      if (!isSupportedPrimitiveType(matchedField.fieldType)) {
        throw new Error(`${FEISHU_ERROR_CODES.FIELD_MISMATCH}: 字段「${fieldName}」类型「${matchedField.fieldType}」当前仅支持有限写入。`);
      }
      if (!isValueCompatible(matchedField.fieldType, value)) {
        throw new Error(`${FEISHU_ERROR_CODES.FIELD_MISMATCH}: 字段「${fieldName}」的值与类型「${matchedField.fieldType}」不兼容。`);
      }
    }
  }

  validateMatchFields(schema: FeishuFieldSchema[], matchByFields: string[]): void {
    if (matchByFields.length === 0) {
      throw new Error(`${FEISHU_ERROR_CODES.FIELD_MISMATCH}: upsert 必须显式提供 matchByFields。`);
    }

    const schemaByName = new Map(schema.map((item) => [item.fieldName, item]));
    for (const fieldName of matchByFields) {
      const matchedField = schemaByName.get(fieldName);
      if (!matchedField) {
        throw new Error(`${FEISHU_ERROR_CODES.FIELD_MISMATCH}: 匹配字段「${fieldName}」不存在。`);
      }
    }
  }
}

export const feishuFieldMapper = new FeishuFieldMapper();
