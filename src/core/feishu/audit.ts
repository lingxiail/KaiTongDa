import type { FeishuRecordWriteResult } from './types';

export function buildFeishuWriteAuditSummary(result: FeishuRecordWriteResult): FeishuRecordWriteResult['audit'] {
  return {
    action: result.action,
    baseId: result.baseId,
    tableId: result.tableId,
    successCount: result.successCount,
    failureCount: result.failureCount,
    createdCount: result.createdCount,
    updatedCount: result.updatedCount,
    matchedCount: result.matchedCount,
    timestamp: Date.now(),
  };
}
