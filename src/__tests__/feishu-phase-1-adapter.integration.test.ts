import { describe, expect, it } from 'vitest';
import { LarkCliAdapter } from '../core/feishu/larkCliAdapter';
import { LarkMcpAdapter } from '../core/feishu/larkMcpAdapter';

describe('Feishu phase 1 adapter refactor', () => {
  it('exposes adapter kind and capabilities for the MCP implementation', () => {
    const adapter = new LarkMcpAdapter();

    expect(adapter.kind).toBe('lark_mcp');
    expect(adapter.getCapabilities()).toContain('query_records');
  });

  it('exposes adapter kind and capabilities for the native CLI implementation', async () => {
    const adapter = new LarkCliAdapter();
    const writeResult = await adapter.createRecords({
      baseId: 'app_001',
      tableId: 'tbl_001',
      records: [],
    });

    expect(adapter.kind).toBe('lark_cli');
    expect(adapter.getCapabilities()).toContain('get_auth_status');
    expect(writeResult.success).toBe(false);
    expect(writeResult.message).toContain('LarkCliAdapter');
  });
});
