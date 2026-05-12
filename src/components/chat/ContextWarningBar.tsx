/**
 * Context Warning Bar — displays context usage alerts above the chat input.
 *
 * Shows a colored banner when context usage reaches warning levels:
 * - Level 1 (60-75%): Yellow warning with compress/new-chat buttons
 * - Level 2-3 (75%+): Red critical with auto-compress indicator
 * - Level 0: Hidden
 */

import { AlertTriangle, Zap, MessageSquarePlus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useChatStore } from '@/stores/chatStore';

export default function ContextWarningBar({
  conversationId,
  onNewChat,
}: {
  conversationId: string;
  onNewChat?: () => void;
}) {
  const { t } = useI18n();
  const level = useChatStore((s) => s.conversations[conversationId]?.contextWarningLevel ?? 0);

  if (level === 0) return null;

  const isCritical = level >= 2;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${
        isCritical
          ? 'bg-red-500/10 text-red-400 border border-red-500/20'
          : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
      }`}
    >
      {isCritical ? (
        <Zap className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="flex-1">
        {isCritical ? t.chat.contextCritical : t.chat.contextWarning}
      </span>
      {!isCritical && (
        <div className="flex items-center gap-1.5">
          {onNewChat && (
            <button
              onClick={onNewChat}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-yellow-500/15 hover:bg-yellow-500/25 transition-colors"
            >
              <MessageSquarePlus className="h-3 w-3" />
              {t.chat.contextNewChatBtn}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
