import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown, Search, Wand2, Bot, X } from 'lucide-react';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

interface SkillAgentPickerProps {
  /** Currently selected skill (null = auto) */
  selectedSkill: string | null;
  /** Currently selected agent (null = auto) */
  selectedAgent: string | null;
  /** Called when user picks or clears a skill */
  onSkillChange: (name: string | null) => void;
  /** Called when user picks or clears an agent */
  onAgentChange: (name: string | null) => void;
  /** Render in a compact row without "more" overflow */
  compact?: boolean;
}

interface PickerItem {
  type: 'skill' | 'agent';
  name: string;
  description: string;
}

const MAX_VISIBLE = 6;

export default function SkillAgentPicker({
  selectedSkill,
  selectedAgent,
  onSkillChange,
  onAgentChange,
  compact = false,
}: SkillAgentPickerProps) {
  const { t } = useI18n();
  const skills = useDiscoveryStore((s) => s.skills);
  const agents = useDiscoveryStore((s) => s.agents);
  const disabledSkills = useSettingsStore((s) => s.disabledSkills);
  const disabledAgents = useSettingsStore((s) => s.disabledAgents);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const disabledSkillSet = useMemo(() => new Set(disabledSkills), [disabledSkills]);
  const disabledAgentSet = useMemo(() => new Set(disabledAgents), [disabledAgents]);

  const allItems = useMemo((): PickerItem[] => {
    const skillItems: PickerItem[] = skills
      .filter((s) => s.userInvocable !== false && !disabledSkillSet.has(s.name))
      .map((s) => ({ type: 'skill' as const, name: s.name, description: s.description }));

    const agentItems: PickerItem[] = agents
      .filter((a) => a.name !== 'abu' && !disabledAgentSet.has(a.name))
      .map((a) => ({ type: 'agent' as const, name: a.name, description: a.description }));

    return [...skillItems, ...agentItems];
  }, [skills, agents, disabledSkillSet, disabledAgentSet]);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return allItems;
    const q = search.toLowerCase();
    return allItems.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q),
    );
  }, [allItems, search]);

  const skillItems = useMemo(
    () => filteredItems.filter((i) => i.type === 'skill'),
    [filteredItems],
   );
  const agentItems = useMemo(
    () => filteredItems.filter((i) => i.type === 'agent'),
    [filteredItems],
  );

  const visibleItems = useMemo(
    () => allItems.slice(0, MAX_VISIBLE),
    [allItems],
  );
  const hasOverflow = allItems.length > MAX_VISIBLE;

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (dropdownOpen) {
      setSearch('');
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [dropdownOpen]);

  const handleSelect = useCallback(
    (item: PickerItem) => {
      if (item.type === 'skill') {
        onSkillChange(selectedSkill === item.name ? null : item.name);
      } else {
        onAgentChange(selectedAgent === item.name ? null : item.name);
      }
      setDropdownOpen(false);
    },
    [selectedSkill, selectedAgent, onSkillChange, onAgentChange],
  );

  const handleClearSkill = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSkillChange(null);
    },
    [onSkillChange],
  );

  const handleClearAgent = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onAgentChange(null);
    },
    [onAgentChange],
  );

  const handleClearBoth = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSkillChange(null);
      onAgentChange(null);
    },
    [onSkillChange, onAgentChange],
  );

  const hasSelected = selectedSkill !== null || selectedAgent !== null;
  const _selectedSkillItem = allItems.find(
    (i) => i.type === 'skill' && i.name === selectedSkill,
  );
  const _selectedAgentItem = allItems.find(
    (i) => i.type === 'agent' && i.name === selectedAgent,
  );

  if (compact) {
    return (
      <div className="relative flex items-center gap-1.5">
        {/* Compact: show selected pills + "+N more" trigger */}
        {selectedSkill && (
          <button
            onClick={handleClearSkill}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors',
              'bg-purple-100 text-purple-700 hover:bg-purple-200',
            )}
            title={t.skillAgentPicker.clearSkill}
          >
            <Wand2 className="h-3 w-3 shrink-0" />
            <span>/{selectedSkill}</span>
            <X className="h-2.5 w-2.5" />
          </button>
        )}
        {selectedAgent && (
          <button
            onClick={handleClearAgent}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors',
              'bg-blue-100 text-blue-700 hover:bg-blue-200',
            )}
            title={t.skillAgentPicker.clearAgent}
          >
            <Bot className="h-3 w-3 shrink-0" />
            <span>@{selectedAgent}</span>
            <X className="h-2.5 w-2.5" />
          </button>
        )}

        {/* Clear all when both selected */}
        {hasSelected && (
          <button
            onClick={handleClearBoth}
            className="text-[11px] text-[var(--abu-text-muted)] hover:text-[var(--abu-text-tertiary)] transition-colors px-1"
            title={t.skillAgentPicker.clearAll}
          >
            {t.skillAgentPicker.clearAll}
          </button>
        )}

        {/* Expand trigger */}
        <button
          ref={triggerRef}
          onClick={() => setDropdownOpen((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors',
            'border border-[var(--abu-border-subtle)] text-[var(--abu-text-tertiary)]',
            'hover:border-[var(--abu-border-hover)] hover:text-[var(--abu-text-primary)]',
          )}
        >
          <ChevronDown
            className={cn(
              'h-3 w-3 transition-transform',
              dropdownOpen && 'rotate-180',
            )}
          />
          {hasOverflow ? (
            <span>
              {t.skillAgentPicker.more}
              {allItems.length > 0 && ` (${allItems.length})`}
            </span>
          ) : (
            <span>{t.skillAgentPicker.choose}</span>
          )}
        </button>

        {renderDropdown()}
      </div>
    );
  }

  // Welcome variant: full horizontal scrollable pill row
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {visibleItems.map((item) => {
        const isSelected =
          item.type === 'skill'
            ? selectedSkill === item.name
            : selectedAgent === item.name;
        return (
          <button
            key={item.name}
            onClick={() => handleSelect(item)}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors',
              isSelected
                ? item.type === 'skill'
                  ? 'bg-purple-200 text-purple-800 border border-purple-300'
                  : 'bg-blue-200 text-blue-800 border border-blue-300'
                : item.type === 'skill'
                  ? 'bg-purple-50 text-purple-700 border border-purple-100 hover:bg-purple-100'
                  : 'bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100',
            )}
          >
            {item.type === 'skill' ? (
              <Wand2 className="h-3 w-3 shrink-0" />
            ) : (
              <Bot className="h-3 w-3 shrink-0" />
            )}
            <span>{item.type === 'skill' ? `/${item.name}` : `@${item.name}`}</span>
          </button>
        );
      })}

      {hasOverflow && (
        <button
          ref={triggerRef}
          onClick={() => setDropdownOpen((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors',
            'border border-[var(--abu-border-subtle)] text-[var(--abu-text-tertiary)]',
            'hover:border-[var(--abu-border-hover)] hover:text-[var(--abu-text-primary)]',
          )}
        >
          <ChevronDown
            className={cn(
              'h-3 w-3 transition-transform',
              dropdownOpen && 'rotate-180',
            )}
          />
          <span>
            {t.skillAgentPicker.more}
            {allItems.length > MAX_VISIBLE &&
              ` (+${allItems.length - MAX_VISIBLE})`}
          </span>
        </button>
      )}

      {/* Clear selection */}
      {hasSelected && (
        <button
          onClick={handleClearBoth}
          className="text-[11px] text-[var(--abu-text-muted)] hover:text-red-500 transition-colors px-1"
          title={t.skillAgentPicker.clearAll}
        >
          {t.skillAgentPicker.clearAll}
        </button>
      )}

      {renderDropdown()}
    </div>
  );

  function renderDropdown() {
    if (!dropdownOpen) return null;

    return (
      <div
        ref={dropdownRef}
        className={cn(
          'absolute z-50 mt-1 rounded-xl border border-[var(--abu-border)]',
          'bg-white shadow-lg overflow-hidden w-72',
        )}
        style={{ bottom: '100%', left: 0, marginBottom: '4px' }}
      >
        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--abu-border-subtle)]">
          <Search className="h-3.5 w-3.5 text-[var(--abu-text-muted)] shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.skillAgentPicker.searchPlaceholder}
            className="flex-1 text-[13px] text-[var(--abu-text-primary)] bg-transparent outline-none placeholder:text-[var(--abu-text-muted)]"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-[var(--abu-text-muted)] hover:text-[var(--abu-text-tertiary)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Items */}
        <div className="max-h-64 overflow-y-auto py-1">
          {skillItems.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold text-[var(--abu-text-muted)] uppercase tracking-wide">
                {t.skillAgentPicker.skills}
              </div>
              {skillItems.map((item) => {
                const isSelected = selectedSkill === item.name;
                return (
                  <button
                    key={item.name}
                    onClick={() =>
                      onSkillChange(isSelected ? null : item.name)
                    }
                    className={cn(
                      'w-full flex items-start gap-2 px-3 py-2 text-left text-[13px] transition-colors',
                      isSelected
                        ? 'bg-purple-50'
                        : 'hover:bg-[var(--abu-bg-muted)]',
                    )}
                  >
                    <Wand2
                      className={cn(
                        'h-3.5 w-3.5 mt-0.5 shrink-0',
                        isSelected
                          ? 'text-purple-600'
                          : 'text-purple-400',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          'font-medium truncate',
                          isSelected
                            ? 'text-purple-700'
                            : 'text-[var(--abu-text-primary)]',
                        )}
                      >
                        /{item.name}
                      </div>
                      {item.description && (
                        <div className="text-[11px] text-[var(--abu-text-tertiary)] truncate mt-0.5">
                          {item.description}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <span className="shrink-0 mt-0.5 text-[10px] text-purple-600 font-medium">
                        {t.skillAgentPicker.selected}
                      </span>
                    )}
                  </button>
                );
              })}
            </>
          )}

          {agentItems.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold text-[var(--abu-text-muted)] uppercase tracking-wide border-t border-[var(--abu-border-subtle)] mt-1">
                {t.skillAgentPicker.agents}
              </div>
              {agentItems.map((item) => {
                const isSelected = selectedAgent === item.name;
                return (
                  <button
                    key={item.name}
                    onClick={() =>
                      onAgentChange(isSelected ? null : item.name)
                    }
                    className={cn(
                      'w-full flex items-start gap-2 px-3 py-2 text-left text-[13px] transition-colors',
                      isSelected
                        ? 'bg-blue-50'
                        : 'hover:bg-[var(--abu-bg-muted)]',
                    )}
                  >
                    <Bot
                      className={cn(
                        'h-3.5 w-3.5 mt-0.5 shrink-0',
                        isSelected ? 'text-blue-600' : 'text-blue-400',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          'font-medium truncate',
                          isSelected
                            ? 'text-blue-700'
                            : 'text-[var(--abu-text-primary)]',
                        )}
                      >
                        @{item.name}
                      </div>
                      {item.description && (
                        <div className="text-[11px] text-[var(--abu-text-tertiary)] truncate mt-0.5">
                          {item.description}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <span className="shrink-0 mt-0.5 text-[10px] text-blue-600 font-medium">
                        {t.skillAgentPicker.selected}
                      </span>
                    )}
                  </button>
                );
              })}
            </>
          )}

          {skillItems.length === 0 && agentItems.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-[var(--abu-text-muted)]">
              {t.skillAgentPicker.noResults}
            </div>
          )}
        </div>
      </div>
    );
  }
}
