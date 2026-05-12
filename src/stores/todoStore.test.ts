import { describe, it, expect, beforeEach } from 'vitest';
import { useTodoStore, type TodoItem } from './todoStore';

// Helper: build a TodoItem with sensible defaults so each test only
// specifies what it cares about. Mirrors the shape todoManager would
// produce in prod — keeps tests honest about what the store sees.
function mkItem(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo-abc',
    content: 'draft plan',
    status: 'pending',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('todoStore', () => {
  beforeEach(() => {
    // Blow away the persisted list every test so one test's state
    // can't leak into another via localStorage rehydration.
    useTodoStore.setState({ lists: {} });
  });

  describe('setList', () => {
    it('replaces the whole list for a conversation', () => {
      const store = useTodoStore.getState();
      store.setList('c1', [mkItem({ id: 'a' }), mkItem({ id: 'b' })]);
      store.setList('c1', [mkItem({ id: 'c' })]);
      // Bulk write must fully replace — callers pass the new canonical
      // list and rely on the store not merging in stale items.
      expect(useTodoStore.getState().lists.c1).toEqual([mkItem({ id: 'c' })]);
    });
  });

  describe('appendItem', () => {
    it('preserves existing items when appending', () => {
      const store = useTodoStore.getState();
      store.setList('c1', [mkItem({ id: 'a' })]);
      store.appendItem('c1', mkItem({ id: 'b' }));
      const list = useTodoStore.getState().lists.c1;
      expect(list).toHaveLength(2);
      expect(list[1].id).toBe('b');
    });

    it('creates the list if the conversation has no todos yet', () => {
      useTodoStore.getState().appendItem('new-conv', mkItem({ id: 'x' }));
      expect(useTodoStore.getState().lists['new-conv']).toHaveLength(1);
    });
  });

  describe('patchItem', () => {
    it('updates status + bumps updatedAt while preserving createdAt', () => {
      const store = useTodoStore.getState();
      store.setList('c1', [mkItem({ id: 'a', createdAt: 1_000, updatedAt: 1_000 })]);
      const before = Date.now();
      const patched = store.patchItem('c1', 'a', { status: 'completed' });
      // createdAt stays put — it's the original creation moment. updatedAt
      // advances to reflect the mutation, mimicking what the old
      // todoManager did directly on the in-memory Map.
      expect(patched?.status).toBe('completed');
      expect(patched?.createdAt).toBe(1_000);
      expect(patched?.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it('returns null when the conversation has no list', () => {
      expect(useTodoStore.getState().patchItem('nonexistent', 'a', {})).toBeNull();
    });

    it('returns null when the id does not exist in the list', () => {
      useTodoStore.getState().setList('c1', [mkItem({ id: 'a' })]);
      // Regression guard: the agent sometimes passes a stale id that
      // was already removed. Store must signal failure (not silently
      // no-op) so the tool layer can return the "计划项不存在" error.
      expect(useTodoStore.getState().patchItem('c1', 'zzz', {})).toBeNull();
    });

    it('only overrides fields the caller specified', () => {
      const store = useTodoStore.getState();
      store.setList('c1', [mkItem({ id: 'a', content: 'first', status: 'pending' })]);
      store.patchItem('c1', 'a', { status: 'in_progress' });
      const item = useTodoStore.getState().lists.c1[0];
      // content was not in the updates → must carry over.
      expect(item.content).toBe('first');
      expect(item.status).toBe('in_progress');
    });
  });

  describe('removeAt', () => {
    it('removes the item at the given index', () => {
      const store = useTodoStore.getState();
      store.setList('c1', [mkItem({ id: 'a' }), mkItem({ id: 'b' }), mkItem({ id: 'c' })]);
      expect(store.removeAt('c1', 1)).toBe(true);
      expect(useTodoStore.getState().lists.c1.map((t) => t.id)).toEqual(['a', 'c']);
    });

    it('returns false when the index is out of range', () => {
      useTodoStore.getState().setList('c1', [mkItem({ id: 'a' })]);
      expect(useTodoStore.getState().removeAt('c1', 5)).toBe(false);
      expect(useTodoStore.getState().removeAt('c1', -1)).toBe(false);
    });

    it('returns false when the conversation has no list', () => {
      expect(useTodoStore.getState().removeAt('nonexistent', 0)).toBe(false);
    });
  });

  describe('clearList', () => {
    it('drops the list entirely (not just empties it)', () => {
      const store = useTodoStore.getState();
      store.setList('c1', [mkItem({ id: 'a' })]);
      store.clearList('c1');
      // deleteConversation in chatStore calls clearList — we want the
      // key GONE, not sitting around as an empty array that would
      // needlessly bloat the persisted blob over time.
      expect('c1' in useTodoStore.getState().lists).toBe(false);
    });

    it('is a no-op on a conversation with no list', () => {
      const before = useTodoStore.getState().lists;
      useTodoStore.getState().clearList('never-seen');
      expect(useTodoStore.getState().lists).toBe(before);
    });
  });

  describe('cross-conversation isolation', () => {
    it('mutations on one conv never touch another', () => {
      // Prior bug style: a bad Map lookup or shared array reference
      // could leak todos between conversations. This test locks down
      // the per-key contract.
      const store = useTodoStore.getState();
      store.setList('conv-a', [mkItem({ id: 'a1' }), mkItem({ id: 'a2' })]);
      store.setList('conv-b', [mkItem({ id: 'b1' })]);
      store.appendItem('conv-a', mkItem({ id: 'a3' }));
      store.patchItem('conv-a', 'a1', { status: 'completed' });
      store.clearList('conv-a');
      // conv-b is untouched through all of conv-a's churn
      expect(useTodoStore.getState().lists['conv-b']).toEqual([mkItem({ id: 'b1' })]);
    });
  });
});
