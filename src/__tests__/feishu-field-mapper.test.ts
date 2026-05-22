import { describe, expect, it } from 'vitest';
import { FeishuFieldMapper } from '../core/feishu/fieldMapper';
import type { FeishuFieldSchema } from '../core/feishu/types';

const schema: FeishuFieldSchema[] = [
  { fieldId: 'fld_name', fieldName: '客户名称', fieldType: 'text', writable: true },
  { fieldId: 'fld_amount', fieldName: '金额', fieldType: 'number', writable: true },
  { fieldId: 'fld_enabled', fieldName: '已启用', fieldType: 'checkbox', writable: true },
  { fieldId: 'fld_followed', fieldName: '跟进时间', fieldType: 'date', writable: true },
  { fieldId: 'fld_owner', fieldName: '负责人', fieldType: 'user', writable: true },
  { fieldId: 'fld_formula', fieldName: '总额', fieldType: 'number', writable: false },
];

describe('FeishuFieldMapper', () => {
  const mapper = new FeishuFieldMapper();

  it('accepts supported primitive field values', () => {
    expect(() => mapper.validateRecords(schema, [{
      客户名称: 'Tom',
      金额: 99,
      已启用: true,
      跟进时间: '2026-05-21',
    }])).not.toThrow();
  });

  it('rejects readonly, unsupported and incompatible write fields', () => {
    expect(() => mapper.validateFields(schema, { 总额: 100 })).toThrow('当前不可写');
    expect(() => mapper.validateFields(schema, { 负责人: { id: 'ou_xxx' } })).toThrow('当前仅支持有限写入');
    expect(() => mapper.validateFields(schema, { 金额: '99' })).toThrow('不兼容');
    expect(() => mapper.validateFields(schema, { 已启用: 'true' })).toThrow('不兼容');
  });

  it('requires explicit valid match fields for upsert', () => {
    expect(() => mapper.validateMatchFields(schema, [])).toThrow('upsert 必须显式提供 matchByFields');
    expect(() => mapper.validateMatchFields(schema, ['不存在字段'])).toThrow('匹配字段「不存在字段」不存在');
    expect(() => mapper.validateMatchFields(schema, ['客户名称'])).not.toThrow();
  });
});
