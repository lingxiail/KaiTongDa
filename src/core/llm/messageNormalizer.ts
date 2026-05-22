/**
 * Message Normalizer — unified preprocessing for multi-provider LLM adapters.
 *
 * Converts internal Message[] into a provider-agnostic PreparedTurn[] that
 * guarantees every tool_use has a matching tool_result. Each provider adapter
 * only needs a thin serializer (~40 lines) to map PreparedTurn[] to its wire format.
 *
 * Three key responsibilities:
 *   1. Orphan fix — tool_use without result gets a placeholder
 *   2. ID generation — stable, provider-agnostic IDs
 *   3. Image extraction — pulled into a dedicated field for serializers
 *   4. Image reload — re-load base64 from filePath for historical messages
 */

import type { Message, MessageContent, ToolCall, ToolCallForContext, ToolResultContent } from '../../types';
import { readFile, exists } from '@tauri-apps/plugin-fs';

/** Re-load image from filePath if data is missing (for historical messages) */
async function reloadImageIfNeeded(block: {
  type: 'image';
  source: { media_type: string; data: string };
  filePath?: string;
}): Promise<{ data: string; mediaType: string }> {
  // If data already exists, use it
  if (block.source.data) {
    return { data: block.source.data, mediaType: block.source.media_type };
  }

  // Try to reload from filePath
  if (block.filePath) {
    try {
      if (await exists(block.filePath)) {
        const bytes = await readFile(block.filePath);
        const binaryStr = Array.from(bytes).map((b) => String.fromCharCode(b)).join('');
        const data = btoa(binaryStr);
        return { data, mediaType: block.source.media_type };
      }
    } catch {
      // Fall through to returning empty data - these images will be skipped
    }
  }

  // Return empty data - will be skipped downstream
  return { data: '', mediaType: block.source.media_type };
}

// ─── Normalized types ────────────────────────────────────────────────

/** A single image extracted from tool result content */
export interface PreparedImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data: string; // base64
}

/** A normalized tool call — `result` is guaranteed non-undefined */
export interface PreparedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: string;
  resultImages: PreparedImage[];
  isError: boolean;
}

/** User content block (text or image) */
export type PreparedContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string }
  | { type: 'document'; mediaType: string; data: string };

/** A normalized conversation turn */
export type PreparedTurn =
  | { kind: 'user'; content: PreparedContentBlock[] }
  | { kind: 'assistant'; text: string; thinking?: string; toolCalls: PreparedToolCall[] };

/** Options for normalizeMessages */
export interface NormalizeOptions {
  /** Whether the target model supports vision/images (default true) */
  supportsVision?: boolean;
}

// ─── Placeholder for orphaned tool calls ─────────────────────────────

const ORPHAN_PLACEHOLDER = '[Tool execution was interrupted]';

// ─── Helpers ─────────────────────────────────────────────────────────

function getTextContent(content: string | MessageContent[]): string {
  if (typeof content === 'string') return content;
  const textBlock = content.find((c) => c.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

/** Generate a stable, provider-safe tool call ID */
function generateToolId(index: number, msgIndex: number): string {
  // Anthropic requires ^[a-zA-Z0-9_-]+$, max 64 chars
  // OpenAI typically uses call_xxx format
  // We use a neutral format; serializers can re-prefix if needed
  return `toolu_${msgIndex}_${index}_${Date.now().toString(36)}`;
}

/** Extract images from ToolResultContent[] */
function extractImages(resultContent: ToolResultContent[] | undefined): PreparedImage[] {
  if (!resultContent || !Array.isArray(resultContent)) return [];
  const images: PreparedImage[] = [];
  for (const b of resultContent) {
    if (b.type === 'image') {
      images.push({ mediaType: b.source.media_type as PreparedImage['mediaType'], data: b.source.data });
    }
  }
  return images;
}

/** Convert user MessageContent[] to PreparedContentBlock[] */
async function convertUserContent(
  content: string | MessageContent[],
  supportsVision: boolean,
): Promise<PreparedContentBlock[]> {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }

  const blocks: PreparedContentBlock[] = [];
  let imageCount = 0;

  for (const c of content) {
    if (c.type === 'text') {
      blocks.push({ type: 'text', text: c.text });
    } else if (c.type === 'image') {
      if (supportsVision) {
        const { data, mediaType } = await reloadImageIfNeeded(c);
        // Skip if data is still empty (couldn't reload)
        if (data) {
          blocks.push({ type: 'image', mediaType, data });
        }
      } else {
        imageCount++;
      }
    } else if (c.type === 'document') {
      blocks.push({ type: 'document', mediaType: c.source.media_type, data: c.source.data });
    }
  }

  // If images were stripped, add a hint
  if (imageCount > 0 && !supportsVision) {
    blocks.push({
      type: 'text',
      text: `[用户上传了${imageCount}张图片，但当前模型不支持图片理解，也无法通过 read_file 等工具间接查看图片。请直接告知用户当前模型不支持图片识别，建议切换到支持视觉的模型。]`,
    });
  }

  return blocks;
}

// ─── Core normalize function ─────────────────────────────────────────

/**
 * Normalize Message[] into PreparedTurn[].
 *
 * Guarantees:
 *   - Every PreparedToolCall has a non-undefined `result`
 *   - Images are extracted into `resultImages` for easy serializer access
 *   - IDs are freshly generated (no stale cross-provider IDs)
 */
export async function normalizeMessages(
  messages: Message[],
  options?: NormalizeOptions,
): Promise<PreparedTurn[]> {
  const supportsVision = options?.supportsVision !== false;
  const turns: PreparedTurn[] = [];

  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      const content = await convertUserContent(msg.content, supportsVision);
      if (content.length > 0) {
        turns.push({ kind: 'user', content });
      }
    } else if (msg.role === 'assistant') {
      const text = getTextContent(msg.content);

      // Prefer toolCallsForContext over toolCalls for LLM history
      const toolCallsSource: (ToolCall | ToolCallForContext)[] =
        msg.toolCallsForContext || msg.toolCalls || [];

      const preparedToolCalls: PreparedToolCall[] = toolCallsSource.map((tc, i) => {
        const result = 'result' in tc ? tc.result : undefined;
        const resultContent = 'resultContent' in tc ? tc.resultContent : undefined;
        const isError = 'isError' in tc ? !!tc.isError : false;
        const rawImages = extractImages(resultContent);
        const images = supportsVision ? rawImages : [];

        // When images are stripped for non-vision models, append a hint so the
        // model knows it cannot see screenshots and should stop requesting them.
        let effectiveResult = result ?? ORPHAN_PLACEHOLDER;
        if (!supportsVision && rawImages.length > 0 && result !== undefined) {
          effectiveResult += '\n[当前模型不支持视觉识别，无法查看截图内容。请使用其他方式获取信息，不要再尝试截图操作。]';
        }

        return {
          id: generateToolId(i, mi),
          name: tc.name,
          input: tc.input,
          result: effectiveResult,
          resultImages: images,
          isError: result === undefined ? true : isError,
        };
      });

      turns.push({
        kind: 'assistant',
        text,
        thinking: msg.thinking,
        toolCalls: preparedToolCalls,
      });
    }
  }

  return turns;
}
