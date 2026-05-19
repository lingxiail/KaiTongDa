import type { FeishuCliCompatibility } from './types';

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

const SUPPORTED_VERSION_RANGE = '>=0.5.0 <0.7.0';
const MIN_SUPPORTED: ParsedVersion = { major: 0, minor: 5, patch: 0 };
const MAX_TESTED_EXCLUSIVE: ParsedVersion = { major: 0, minor: 7, patch: 0 };

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

export function parseCliVersion(raw?: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match[0] : null;
}

function parseVersionObject(raw?: string | null): ParsedVersion | null {
  const normalized = parseCliVersion(raw);
  if (!normalized) return null;
  const [major, minor, patch] = normalized.split('.').map(Number);
  return { major, minor, patch };
}

export function assessCliCompatibility(rawVersion?: string | null): FeishuCliCompatibility {
  const detectedVersion = parseCliVersion(rawVersion);
  const parsed = parseVersionObject(rawVersion);

  if (!parsed) {
    return {
      status: 'unknown',
      detectedVersion,
      supportedRange: SUPPORTED_VERSION_RANGE,
      message: '尚未识别出飞书 CLI 版本，建议先确认当前安装版本是否在已验证范围内。',
    };
  }

  const aboveMin = compareVersions(parsed, MIN_SUPPORTED) >= 0;
  const belowMax = compareVersions(parsed, MAX_TESTED_EXCLUSIVE) < 0;
  if (aboveMin && belowMax) {
    return {
      status: 'compatible',
      detectedVersion,
      supportedRange: SUPPORTED_VERSION_RANGE,
      message: `当前飞书 CLI 版本 ${detectedVersion} 在已验证兼容范围内。`,
    };
  }

  return {
    status: 'untested',
    detectedVersion,
    supportedRange: SUPPORTED_VERSION_RANGE,
    message: `当前飞书 CLI 版本 ${detectedVersion} 超出已验证范围 ${SUPPORTED_VERSION_RANGE}，建议优先回归关键链路。`,
  };
}
