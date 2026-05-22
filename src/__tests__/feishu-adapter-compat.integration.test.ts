import { describe, expect, it } from 'vitest';
import { FeishuBaseService } from '../core/feishu/baseService';
import * as feishuExports from '../core/feishu';
import { LarkCliAdapter } from '../core/feishu/larkCliAdapter';
import { LarkMcpAdapter } from '../core/feishu/larkMcpAdapter';

describe('Feishu adapter defaults and compatibility', () => {
  it('exposes adapter kind and capabilities for the legacy MCP connector', () => {
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
    expect(writeResult.success).toBe(true);
    expect(writeResult.createdCount).toBe(0);
    expect(writeResult.message).toContain('没有需要新增的记录');
  });

  it('uses the native CLI adapter as the default base service connector', () => {
    const service = new FeishuBaseService();

    expect(service['adapter'].kind).toBe('lark_cli');
  });

  it('does not expose the legacy cliAdapter compatibility module from the Feishu barrel', () => {
    expect('FeishuCliAdapter' in feishuExports).toBe(false);
    expect('FeishuCliRawResult' in feishuExports).toBe(false);
    expect('FeishuCliLoginHandle' in feishuExports).toBe(false);
  });
});
