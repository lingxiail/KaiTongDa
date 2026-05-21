import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LarkCliAdapter } from '../core/feishu/larkCliAdapter';

const invokeMock = vi.mocked(invoke);

describe('LarkCliAdapter argv execution', () => {
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

  it('executes create and parses structured write result', async () => {
    invokeMock.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({
        data: {
          created_count: 2,
          records: [{ record_id: 'rec_1' }, { record_id: 'rec_2' }],
        },
      }),
      stderr: '',
    });

    const result = await new LarkCliAdapter().createRecords({
      baseId: 'app_1',
      tableId: 'tbl_1',
      records: [{ 客户名称: 'Tom' }, { 客户名称: 'Jerry' }],
    });

    expect(invokeMock).toHaveBeenCalledWith('run_argv_command', expect.objectContaining({
      program: 'lark-cli',
      args: [
        'base',
        'record',
        'create',
        '--base-id',
        'app_1',
        '--table-id',
        'tbl_1',
        '--format',
        'json',
        '--records-json',
        JSON.stringify([{ 客户名称: 'Tom' }, { 客户名称: 'Jerry' }]),
      ],
      timeout: 120,
    }));
    expect(result.success).toBe(true);
    expect(result.createdCount).toBe(2);
    expect(result.failureCount).toBe(0);
  });

  it('executes upsert and update commands with parsed counters', async () => {
    invokeMock
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify({
          data: {
            created_count: 1,
            updated_count: 1,
            matched_count: 1,
            success_count: 2,
          },
        }),
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify({
          data: {
            matched_count: 3,
            updated_count: 3,
          },
        }),
        stderr: '',
      });

    const adapter = new LarkCliAdapter();
    const upsertResult = await adapter.upsertRecords({
      baseId: 'app_1',
      tableId: 'tbl_1',
      matchByFields: ['客户名称'],
      records: [{ 客户名称: 'Tom' }, { 客户名称: 'Jerry' }],
    });
    const updateResult = await adapter.updateRecordsByFilter({
      baseId: 'app_1',
      tableId: 'tbl_1',
      filter: { status: 'pending' },
      fields: { 已启用: true },
    });

    expect(upsertResult.createdCount).toBe(1);
    expect(upsertResult.updatedCount).toBe(1);
    expect(upsertResult.matchedCount).toBe(1);
    expect(updateResult.updatedCount).toBe(3);
    expect(updateResult.matchedCount).toBe(3);
    expect(updateResult.success).toBe(true);
  });

  it('returns failed write result when CLI write exits non-zero', async () => {
    invokeMock.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: 'tenant_access_token=secret_demo',
    });

    const result = await new LarkCliAdapter().createRecords({
      baseId: 'app_1',
      tableId: 'tbl_1',
      records: [{ 客户名称: 'Tom' }],
    });

    expect(result.success).toBe(false);
    expect(result.failureCount).toBe(1);
    expect(result.message).toContain('[REDACTED]');
  });
});
