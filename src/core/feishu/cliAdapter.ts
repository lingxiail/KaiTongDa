import type {
  FeishuCommandRawResult,
  FeishuConnectorAdapter,
  FeishuConnectorLoginHandle,
} from './connectorAdapter';

export type FeishuCliRawResult = FeishuCommandRawResult;
export type FeishuCliLoginHandle = FeishuConnectorLoginHandle;
export type FeishuCliAdapter = FeishuConnectorAdapter;

export { LarkMcpAdapter, larkMcpAdapter } from './larkMcpAdapter';
export {
  LarkMcpAdapter as LarkMcpCliAdapter,
  larkMcpAdapter as feishuCliAdapter,
} from './larkMcpAdapter';