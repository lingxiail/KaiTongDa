import { describe, expect, it, beforeEach } from 'vitest';
import { runAIServicesChecks } from './aiServices';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ProviderInstance } from '@/types/provider';

function makeProvider(overrides: Partial<ProviderInstance> = {}): ProviderInstance {
  return {
    id: 'p1',
    source: 'builtin',
    name: 'Provider 1',
    enabled: true,
    apiFormat: 'openai-compatible',
    baseUrl: 'https://api.example.com',
    apiKey: '',
    models: [{ id: 'm1', label: 'Model 1' }],
    status: 'unchecked',
    sortOrder: 0,
    ...overrides,
  };
}

describe('runAIServicesChecks', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      providers: [],
      activeModel: { providerId: '', modelId: '' },
    });
  });

  it('ignores the legacy qiniu placeholder provider', async () => {
    useSettingsStore.setState({
      providers: [
        makeProvider({
          id: 'qiniu',
          name: '七牛云 (Qiniu)',
          enabled: true,
        }),
      ],
    });

    const results = await runAIServicesChecks();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'ai-services:none',
      status: 'warning',
    });
  });
});
