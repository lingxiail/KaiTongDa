/**
 * Notice Pipeline — orchestrates Bus → Gate → Router → Channel dispatch.
 *
 * This module replaces the blanket fan-out in bus.ts with the full
 * Gate/Router pipeline. Bus calls `processNotice` after dedup; the
 * pipeline runs Gate filter, then (if allowed) Router dispatch, then
 * delivers to targeted channel handlers only.
 *
 * Quota consumption: when Gate allows an L2 notice, pipeline calls
 * consumeL2Quota so the sliding window stays accurate.
 *
 * GateContext assembly: the pipeline reads runtime state (window focus,
 * pet state, fullscreen) from a pluggable context provider. Day 5
 * ships a default provider that returns safe defaults; Week 2 wires
 * the real providers (Tauri window focus, fullscreen Rust command, etc).
 */

import type { Notice } from './types';
import { filter, type GateContext, type GateDecision } from './gate';
import { route, type DeliveryTarget } from './router';
import { consumeL2Quota } from './quota';
import { recordAudit } from './audit';
import { queueToInbox } from './inbox';

// ── Context provider ───────────────────────────────────────────────────

export type GateContextProvider = (now: number) => GateContext;

const defaultContextProvider: GateContextProvider = (now) => ({
  now,
  mainWindowFocused: true,
  currentConversationId: null,
  petState: 'off',
  fullscreenApp: null,
  recentL2Count: { windowStart: 0, count: 0 },
  userFeedbackHistory: [],
});

let contextProvider: GateContextProvider = defaultContextProvider;

export function setContextProvider(provider: GateContextProvider): void {
  contextProvider = provider;
}

export function resetContextProviderForTest(): void {
  contextProvider = defaultContextProvider;
}

// ── Channel handler registry ───────────────────────────────────────────

export type ChannelHandler = (notice: Notice, target: DeliveryTarget) => void | Promise<void>;

type DeliveryChannelName = DeliveryTarget['channel'];

const channelHandlers = new Map<DeliveryChannelName, Set<ChannelHandler>>();

export function registerChannel(
  channel: DeliveryChannelName,
  handler: ChannelHandler,
): () => void {
  let set = channelHandlers.get(channel);
  if (!set) {
    set = new Set();
    channelHandlers.set(channel, set);
  }
  set.add(handler);
  return () => {
    const current = channelHandlers.get(channel);
    if (current) current.delete(handler);
  };
}

// ── Pipeline result (for audit / debugging) ────────────────────────────

export interface PipelineResult {
  decision: GateDecision;
  targets: DeliveryTarget[];
}

// ── Core pipeline ──────────────────────────────────────────────────────

/**
 * Run a notice through Gate → Router → Channel dispatch.
 * Returns the pipeline result for audit/logging (Week 2 notice_audit).
 */
export function processNotice(notice: Notice): PipelineResult {
  const now = notice.createdAt;
  const ctx = contextProvider(now);

  const decision = filter(notice, ctx);

  if (decision.action !== 'allow' && decision.action !== 'degrade_tier') {
    if (decision.action === 'queue_inbox') {
      queueToInbox(notice);
      // Queued notices still surface via non-invasive channels so the
      // unread-count surfaces (menubar tray icon, per-conversation
      // sidebar badge) aren't silently bypassed. Only badge-style
      // channels — no toast, no system notification — since Gate has
      // already decided this is not the right moment to interrupt.
      // Phase 2 (main-window toast strip) will aggregate these on the
      // user's return; until then, the badges do the heavy lifting.
      const convoId = notice.payload.conversationId;
      const silentTargets: DeliveryTarget[] = [{ channel: 'menubar' }];
      if (typeof convoId === 'string' && convoId.length > 0) {
        silentTargets.push({ channel: 'sidebar_badge', conversationId: convoId });
      }
      dispatchTargets(notice, silentTargets);
      recordAudit(notice, decision, silentTargets);
      return { decision, targets: silentTargets };
    }
    recordAudit(notice, decision, []);
    return { decision, targets: [] };
  }

  // Apply tier degradation before routing
  const routedNotice: Notice =
    decision.action === 'degrade_tier'
      ? { ...notice, tier: decision.to }
      : notice;

  // Consume L2 quota on allowed L2 notices
  if (routedNotice.tier === 'L2') {
    consumeL2Quota(now);
  }

  const targets = route(routedNotice, ctx);

  // Dispatch to targeted channel handlers
  for (const target of targets) {
    const handlers = channelHandlers.get(target.channel);
    if (!handlers) continue;
    for (const handler of handlers) {
      try {
        const result = handler(routedNotice, target);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => {
            console.error(`[notice] channel:${target.channel} handler rejected:`, err);
          });
        }
      } catch (err) {
        console.error(`[notice] channel:${target.channel} handler threw:`, err);
      }
    }
  }

  recordAudit(routedNotice, decision, targets);

  return { decision, targets };
}

/**
 * Dispatch a notice directly to pre-computed channel targets, bypassing
 * Gate. Used by inbox drain where the caller has already chosen targets
 * based on the current context (so re-running Gate would just re-queue
 * L2s back into the inbox).
 *
 * Does not record audit — drain-side audit semantics (delivered-via-drain
 * vs delivered-normal) are a Phase 2 concern.
 */
export function dispatchTargets(notice: Notice, targets: DeliveryTarget[]): void {
  for (const target of targets) {
    const handlers = channelHandlers.get(target.channel);
    if (!handlers) continue;
    for (const handler of handlers) {
      try {
        const result = handler(notice, target);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => {
            console.error(`[notice] channel:${target.channel} handler rejected:`, err);
          });
        }
      } catch (err) {
        console.error(`[notice] channel:${target.channel} handler threw:`, err);
      }
    }
  }
}

// ── Test utilities ─────────────────────────────────────────────────────

export function clearChannelHandlersForTest(): void {
  channelHandlers.clear();
}
