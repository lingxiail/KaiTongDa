import { describe, expect, it } from 'vitest';
import {
  buildAuthLoginCommand,
  buildCreateRecordsCommand,
  buildListTablesCommand,
  buildQueryRecordsCommand,
  buildUpdateRecordsCommand,
  buildUpsertRecordsCommand,
} from '../core/feishu/larkCliCommands';

describe('Feishu lark-cli command builders', () => {
  it('builds login argv without shell interpolation', () => {
    const command = buildAuthLoginCommand({
      appId: 'cli_demo',
      appSecret: 'secret_demo',
      domain: 'https://open.feishu.cn',
      preferredScopes: ['bitable:app', 'contact:user.base:readonly'],
      port: 3001,
    });

    expect(command.program).toBe('lark-cli');
    expect(command.args).toEqual([
      'auth',
      'login',
      '--recommend',
      '--domain',
      'https://open.feishu.cn',
      '--port',
      '3001',
      '--scope',
      'bitable:app',
      'contact:user.base:readonly',
    ]);
  });

  it('keeps table and record query values as raw argv elements', () => {
    const command = buildQueryRecordsCommand({
      baseId: 'app 客户',
      tableId: 'tbl "VIP" 客户',
      fieldNames: ['客户名称', '跟进 备注'],
      filter: {
        and: [{ field_name: '客户名称', operator: 'is', value: ['Tom "A"'] }],
      },
      sort: [{ fieldName: '最近跟进时间', desc: true }],
      pageSize: 10,
      pageToken: 'page next',
    });

    expect(command.program).toBe('lark-cli');
    expect(command.args[0]).toBe('base');
    expect(command.args).toContain('--format');
    expect(command.args).toContain('json');
    expect(command.args).toContain('app 客户');
    expect(command.args).toContain('tbl "VIP" 客户');
    expect(command.args).toContain('客户名称,跟进 备注');
    expect(command.args).toContain(JSON.stringify({
      and: [{ field_name: '客户名称', operator: 'is', value: ['Tom "A"'] }],
    }));
  });

  it('builds write commands with JSON payload args instead of shell snippets', () => {
    const createCommand = buildCreateRecordsCommand({
      baseId: 'app_001',
      tableId: 'tbl_001',
      records: [{ 客户名称: 'Tom', 备注: '含空格 和 "引号"' }],
    });
    const updateCommand = buildUpdateRecordsCommand({
      baseId: 'app_001',
      tableId: 'tbl_001',
      filter: { field_name: '客户名称', operator: 'is', value: ['Tom'] },
      fields: { 备注: '改成 "VIP"' },
    });
    const upsertCommand = buildUpsertRecordsCommand({
      baseId: 'app_001',
      tableId: 'tbl_001',
      matchByFields: ['客户名称'],
      records: [{ 客户名称: 'Tom', 备注: '跟进中' }],
    });
    const listTablesCommand = buildListTablesCommand({
      baseId: 'app team',
      pageSize: 50,
      pageToken: 'next token',
    });

    expect(createCommand.args).toContain(JSON.stringify([{ 客户名称: 'Tom', 备注: '含空格 和 "引号"' }]));
    expect(createCommand.args).toContain('--format');
    expect(createCommand.args).toContain('json');
    expect(updateCommand.args).toContain(JSON.stringify({ 备注: '改成 "VIP"' }));
    expect(updateCommand.args).toContain('--format');
    expect(upsertCommand.args).toContain('--format');
    expect(upsertCommand.args).toContain('json');
    expect(listTablesCommand.args).toEqual([
      'base',
      'table',
      'list',
      '--base-id',
      'app team',
      '--format',
      'json',
      '--page-size',
      '50',
      '--page-token',
      'next token',
    ]);
  });
});
