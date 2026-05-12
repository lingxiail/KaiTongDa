/**
 * Todo store — persisted per-conversation todo lists.
 *
 * Background: todoManager.ts used to hold these in a bare in-memory Map,
 * which meant that the moment the app restarted, any running
 * conversation's plan evaporated. The agent would then call
 * `todo_write(action='update', todo_id=N)` and get back "计划项 N 不存在",
 * derailing whatever it was doing. See `project_todo_write_not_exist_bug`
 * memory record for the repro.
 *
 * This store is the persistence layer; `todoManager.ts` stays as the
 * public, non-React surface (agentLoop + tool impls import from it), and
 * simply proxies reads/writes through here. That keeps the migration
 * low-risk: 4 call sites keep their existing API, and this store is
 * only ever touched via those 7 function wrappers.
 *
 * Structure: a flat `lists: Record<conversationId, TodoItem[]>`. No
 * cross-conversation leakage; deleting a conversation calls
 * `clearList(convId)` via chatStore.deleteConversation → todoManager.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Todo item status — mirrors the public type in todoManager. */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  createdAt: number;
  updatedAt: number;
}

interface TodoState {
  /** Keyed by conversationId. Each value is an ordered todo list. */
  lists: Record<string, TodoItem[]>;
}

interface TodoActions {
  /** Replace the whole list for a conversation (bulk write). */
  setList: (conversationId: string, items: TodoItem[]) => void;
  /** Append one item; caller provides the fully-constructed TodoItem. */
  appendItem: (conversationId: string, item: TodoItem) => void;
  /** Patch a single item by id (immutable update, returns new item or null). */
  patchItem: (
    conversationId: string,
    todoId: string,
    updates: { status?: TodoStatus; content?: string },
  ) => TodoItem | null;
  /** Remove an item by 0-based index (caller resolves 1-based vs id). */
  removeAt: (conversationId: string, index: number) => boolean;
  /** Drop all todos for a conversation (called when the conv is deleted). */
  clearList: (conversationId: string) => void;
}

export type TodoStore = TodoState & TodoActions;

export const useTodoStore = create<TodoStore>()(
  persist(
    (set, get) => ({
      lists: {},

      setList: (conversationId, items) => {
        set((state) => ({ lists: { ...state.lists, [conversationId]: items } }));
      },

      appendItem: (conversationId, item) => {
        set((state) => {
          const prev = state.lists[conversationId] ?? [];
          return { lists: { ...state.lists, [conversationId]: [...prev, item] } };
        });
      },

      patchItem: (conversationId, todoId, updates) => {
        const list = get().lists[conversationId];
        if (!list) return null;
        const idx = list.findIndex((t) => t.id === todoId);
        if (idx < 0) return null;
        const old = list[idx];
        const next: TodoItem = {
          ...old,
          status: updates.status ?? old.status,
          content: updates.content ?? old.content,
          updatedAt: Date.now(),
        };
        const newList = [...list];
        newList[idx] = next;
        set((state) => ({ lists: { ...state.lists, [conversationId]: newList } }));
        return next;
      },

      removeAt: (conversationId, index) => {
        const list = get().lists[conversationId];
        if (!list) return false;
        if (index < 0 || index >= list.length) return false;
        const newList = list.slice(0, index).concat(list.slice(index + 1));
        set((state) => ({ lists: { ...state.lists, [conversationId]: newList } }));
        return true;
      },

      clearList: (conversationId) => {
        set((state) => {
          if (!(conversationId in state.lists)) return state;
          const newLists = { ...state.lists };
          delete newLists[conversationId];
          return { lists: newLists };
        });
      },
    }),
    {
      name: 'abu-todos',
      version: 1,
      partialize: (state) => ({ lists: state.lists }),
    },
  ),
);
