import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LarkCliAdapter } from '../core/feishu/larkCliAdapter';

const invokeMock = vi.mocked(invoke);

describe('LarkCliAdapter read commands', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('executes list bases through argv and scrubs command output', async () => {
    invokeMock.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({
        data: {
          files: [{ file_token: 'app_sales', title: '销售 Base', type: 'bitable' }],
          has_more: false,
          tenant_access_token: 't-secret',
        },
      }),
      stderr: 'owner tom@example.com',
    });

    const raw = await new LarkCliAdapter().listBases({ folderToken: 'fld_team', pageSize: 20, pageToken: 'next' });

    expect(invokeMock).toHaveBeenCalledWith('run_argv_command', {
      program: 'lark-cli',
      args: ['base', 'list', '--format', 'json', '--folder-token', 'fld_team', '--page-size', '20', '--page-token', 'next'],
      cwd: null,
      timeout: 60,
      sandboxEnabled: false,
      networkIsolation: false,
    });
    expect(raw.command).toBe('lark-cli base list --format json --folder-token fld_team --page-size 20 --page-token next');
    expect(raw.stdout).toContain('[REDACTED]');
    expect(raw.stderr).toBe('owner [REDACTED_EMAIL]');
  });

  it('executes table schema and record queries with machine-readable output', async () => {
    invokeMock.mockResolvedValue({ code: 0, stdout: JSON.stringify({ data: { items: [] } }), stderr: '' });
    const adapter = new LarkCliAdapter();

    await adapter.getTableSchema({ baseId: 'app_1', tableId: 'tbl_1', pageSize: 50 });
    await adapter.queryRecords({
      baseId: 'app_1',
      tableId: 'tbl_1',
      fieldNames: ['客户名称', '备注'],
      filter: { field_name: '客户名称', operator: 'is', value: ['Tom'] },
      sort: [{ fieldName: '最近跟进时间', desc: true }],
      pageSize: 10,
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'run_argv_command', expect.objectContaining({
      program: 'lark-cli',
      args: ['base', 'field', 'list', '--base-id', 'app_1', '--table-id', 'tbl_1', '--format', 'json', '--page-size', '50'],
      timeout: 60,
    }));
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'run_argv_command', expect.objectContaining({
      program: 'lark-cli',
      args: [
        'base',
        'record',
        'search',
        '--base-id',
        'app_1',
        '--table-id',
        'tbl_1',
        '--format',
        'json',
        '--filter-json',
        JSON.stringify({ field_name: '客户名称', operator: 'is', value: ['Tom'] }),
        '--sort-json',
        JSON.stringify([{ fieldName: '最近跟进时间', desc: true }]),
        '--field-names',
        '客户名称,备注',
        '--page-size',
        '10',
      ],
      timeout: 90,
    }));
  });

  it('returns sanitized failures when argv execution throws', async () => {
    invokeMock.mockRejectedValue(new Error('token=secret_123 owner 13800138000'));

    const raw = await new LarkCliAdapter().listTables({ baseId: 'app_1' });

    expect(raw.code).toBe(-1);
    expect(raw.command).toBe('lark-cli base table list --base-id app_1 --format json');
    expect(raw.stderr).toBe('token=[REDACTED] owner [REDACTED_PHONE]');
  });
});
