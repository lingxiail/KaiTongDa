import type { FeishuWriteAction, FeishuWriteConfirmation } from './types';

export interface FeishuWritePolicyConfig {
  createConfirmThreshold: number;
  upsertConfirmThreshold: number;
  updateMatchConfirmThreshold: number;
}

const DEFAULT_POLICY: FeishuWritePolicyConfig = {
  createConfirmThreshold: 20,
  upsertConfirmThreshold: 20,
  updateMatchConfirmThreshold: 10,
};

export class FeishuWritePolicy {
  constructor(private readonly config: FeishuWritePolicyConfig = DEFAULT_POLICY) {}

  evaluate(action: FeishuWriteAction, count: number, confirmed = false): FeishuWriteConfirmation {
    const threshold = this.getThreshold(action);
    if (count <= threshold) {
      return {
        required: false,
        confirmed,
        threshold,
      };
    }

    return {
      required: !confirmed,
      confirmed,
      threshold,
      reason: this.buildReason(action, count, threshold),
    };
  }

  private getThreshold(action: FeishuWriteAction): number {
    switch (action) {
      case 'create':
        return this.config.createConfirmThreshold;
      case 'upsert':
        return this.config.upsertConfirmThreshold;
      case 'update_by_filter':
        return this.config.updateMatchConfirmThreshold;
      default:
        return DEFAULT_POLICY.updateMatchConfirmThreshold;
    }
  }

  private buildReason(action: FeishuWriteAction, count: number, threshold: number): string {
    if (action === 'update_by_filter') {
      return `本次更新命中 ${count} 条记录，超过确认阈值 ${threshold}，请显式确认后再执行。`;
    }
    return `本次${action === 'create' ? '新增' : 'upsert'}将写入 ${count} 条记录，超过确认阈值 ${threshold}，请显式确认后再执行。`;
  }
}

export const feishuWritePolicy = new FeishuWritePolicy();
