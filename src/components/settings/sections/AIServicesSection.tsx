import { useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useI18n } from '@/i18n';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import ProviderCard from './ai-services/ProviderCard';
import AddProviderModal from './ai-services/AddProviderModal';

export default function AIServicesSection() {
  const { t } = useI18n();
  const providers = useSettingsStore((s) => s.providers);
  const activeModel = useSettingsStore((s) => s.activeModel);
  const clearAllStoredKeys = useSettingsStore((s) => s.clearAllStoredKeys);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const visibleProvider = (provider: typeof providers[number]) => provider.id !== 'qiniu';

  // Only show providers the user has actually configured.
  // `userAdded` is the authoritative flag (set by AddProviderModal); the
  // `enabled || apiKey` fallback covers legacy data not yet migrated.
  // Toggling off or clearing the key MUST NOT remove the card — the user
  // reads disappearance as accidental deletion. Only the trash-can action
  // (handleDeleteConfirm) hides a builtin provider, by clearing userAdded.
  const visibleProviders = providers
    .filter(p => visibleProvider(p) && (p.userAdded || p.enabled || p.apiKey.trim().length > 0))
    .sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    });
  const enabledCount = visibleProviders.filter(p => p.enabled).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-[var(--abu-text-primary)]">
            {t.settings.aiServices}
          </h3>
          {enabledCount > 0 && (
            <p className="text-xs text-[var(--abu-text-muted)] mt-0.5">
              {t.settings.enabledCount.replace('{count}', String(enabledCount))}
            </p>
          )}
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={() => setShowAddModal(true)}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.settings.addService}
        </Button>
      </div>

      {/* Provider List */}
      {visibleProviders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm text-[var(--abu-text-muted)]">{t.settings.noProviders}</p>
          <p className="text-xs text-[var(--abu-text-muted)] mt-1">{t.settings.noProvidersHint}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddModal(true)}
            className="mt-4 gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.settings.addService}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleProviders.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              isActive={activeModel.providerId === provider.id}
            />
          ))}
        </div>
      )}

      {/* Danger zone: hard-reset escape hatch for stuck / migrated / compromised keys */}
      {providers.some((p) => visibleProvider(p) && p.apiKey.trim().length > 0) && (
        <div className="pt-2 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowClearConfirm(true)}
            className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t.settings.clearAllKeys}
          </Button>
        </div>
      )}

      {/* Add Provider Modal */}
      <AddProviderModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
      />

      <ConfirmDialog
        open={showClearConfirm}
        title={t.settings.clearAllKeys}
        message={t.settings.clearAllKeysConfirm}
        confirmText={t.common.confirm}
        cancelText={t.common.cancel}
        variant="danger"
        onConfirm={async () => {
          setShowClearConfirm(false);
          await clearAllStoredKeys();
        }}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  );
}
