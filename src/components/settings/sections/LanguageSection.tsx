import { useSettingsStore } from '@/stores/settingsStore';
import { type LanguageSetting, useI18n } from '@/i18n';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LanguageSection() {
  const { language, setLanguage } = useSettingsStore();
  const { t } = useI18n();

  const languageOptions: { value: LanguageSetting; label: string; desc: string }[] = [
    { value: 'system', label: t.settings.followSystem, desc: t.settings.languageDescription },
    { value: 'zh-CN', label: '简体中文', desc: 'Simplified Chinese' },
    { value: 'en-US', label: 'English', desc: 'English' },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--lingxi-text-tertiary)]">
        {t.settings.languageDescription}
      </p>

      <div className="space-y-2">
        {languageOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => setLanguage(option.value)}
            className={cn(
              'w-full flex items-center justify-between p-4 rounded-xl border transition-all text-left',
              language === option.value
                ? 'border-[var(--lingxi-clay)] bg-[var(--lingxi-clay-5)]'
                : 'border-[var(--lingxi-border)] bg-[var(--lingxi-bg-muted)] hover:border-[var(--lingxi-clay-50)]'
            )}
          >
            <div>
              <p className={cn(
                'text-sm font-medium',
                language === option.value ? 'text-[var(--lingxi-clay)]' : 'text-[var(--lingxi-text-primary)]'
              )}>
                {option.label}
              </p>
              <p className="text-xs text-[var(--lingxi-text-muted)] mt-0.5">{option.desc}</p>
            </div>
            {language === option.value && (
              <div className="w-5 h-5 rounded-full bg-[var(--lingxi-clay)] flex items-center justify-center">
                <Check className="h-3 w-3 text-white" />
              </div>
            )}
          </button>
        ))}
      </div>

    </div>
  );
}
