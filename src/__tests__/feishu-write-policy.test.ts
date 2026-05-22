import { describe, expect, it } from 'vitest';
import { FeishuWritePolicy } from '../core/feishu/writePolicy';

describe('FeishuWritePolicy', () => {
  const policy = new FeishuWritePolicy({
    createConfirmThreshold: 2,
    upsertConfirmThreshold: 3,
    updateMatchConfirmThreshold: 1,
  });

  it('allows writes at the configured threshold without confirmation', () => {
    expect(policy.evaluate('create', 2)).toMatchObject({
      required: false,
      confirmed: false,
      threshold: 2,
    });
    expect(policy.evaluate('upsert', 3)).toMatchObject({
      required: false,
      confirmed: false,
      threshold: 3,
    });
    expect(policy.evaluate('update_by_filter', 1)).toMatchObject({
      required: false,
      confirmed: false,
      threshold: 1,
    });
  });

  it('requires confirmation when write size exceeds the configured threshold', () => {
    const result = policy.evaluate('create', 3);

    expect(result.required).toBe(true);
    expect(result.confirmed).toBe(false);
    expect(result.threshold).toBe(2);
    expect(result.reason).toContain('超过确认阈值');
  });

  it('records confirmed writes as allowed after the threshold is exceeded', () => {
    const result = policy.evaluate('update_by_filter', 2, true);

    expect(result.required).toBe(false);
    expect(result.confirmed).toBe(true);
    expect(result.threshold).toBe(1);
    expect(result.reason).toContain('超过确认阈值');
  });
});
