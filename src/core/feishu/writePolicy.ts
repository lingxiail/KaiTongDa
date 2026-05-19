import { buildWriteConfirmationMessage } from './messages';
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
    return buildWriteConfirmationMessage(action, count, threshold);
  }
}

export const feishuWritePolicy = new FeishuWritePolicy();
