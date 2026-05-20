import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatformForTest } from '../../test/helpers';
import { LarkMcpCliAdapter } from './cliAdapter';

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

describe('LarkMcpCliAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps npx argv calls through cmd.exe on Windows', async () => {
    const cleanup = setPlatformForTest('windows');
    mockInvoke.mockResolvedValue({ stdout: '0.5.1', stderr: '', code: 0 });

    try {
      const adapter = new LarkMcpCliAdapter();
      const result = await adapter.checkCliVersion();

      expect(result.stdout).toBe('0.5.1');
      expect(mockInvoke).toHaveBeenCalledWith('run_argv_command', expect.objectContaining({
        program: 'cmd.exe',
        args: ['/D', '/C', 'npx', '-y', '@larksuiteoapi/lark-mcp', '--version'],
      }));
    } finally {
      cleanup();
    }
  });

  it('uses the PowerShell invocation operator for Windows login commands', async () => {
    const cleanup = setPlatformForTest('windows');
    mockListen.mockResolvedValue(vi.fn());
    mockInvoke.mockResolvedValue({ stdout: 'Login successful', stderr: '', code: 0 });

    try {
      const adapter = new LarkMcpCliAdapter();
      const handle = await adapter.startLogin({
        appId: 'cli_test',
        appSecret: 'secret_test',
        domain: 'https://open.feishu.cn',
      });
      await handle.completion;

      expect(mockInvoke).toHaveBeenCalledWith('run_shell_command_streaming', expect.objectContaining({
        command: expect.stringContaining("& 'npx' '-y' '@larksuiteoapi/lark-mcp' 'login'"),
      }));
    } finally {
      cleanup();
    }
  });
});
