/**
 * Todo Manager — structured task tracking for agent planning.
 *
 * Similar to Claude Code's TodoWrite/TodoRead pattern. Todo state is
 * injected into the system prompt each turn so the agent always sees its
 * current plan and progress. Per-conversation todo lists, keyed by
 * conversationId.
 *
 * Persistence: the backing store is `stores/todoStore.ts` (zustand +
 * persist), which keeps todos across app restarts. Before the store
 * existed, this file held a bare in-memory Map and the agent would
 * crash on `todo_write(action=update)` after any restart with
 * "计划项 N 不存在". This file is now a thin non-React facade so that
 * agentLoop + tool definitions (which can't use React hooks) keep
 * their existing sync API surface.
 *
 * The list-change subscribe mechanism also routes through zustand now —
 * `subscribeToTodos(cb)` is just a thin wrapper around the store's
 * subscribe that fires cb on any lists mutation. Same behavior as the
 * old Set-of-listeners; zustand does the notification plumbing.
 */

import { useTodoStore, type TodoItem, type TodoStatus } from '../../stores/todoStore';

export type { TodoItem, TodoStatus };

function generateTodoId(): string {
  return `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Get all todos for a conversation. Returns [] when there's nothing
 * persisted, matching the old in-memory Map semantics.
 */
export function getTodos(conversationId: string): TodoItem[] {
  return useTodoStore.getState().lists[conversationId] ?? [];
}

/**
 * Add a todo item. Generates a fresh id, default status 'pending'.
 */
export function addTodo(conversationId: string, content: string): TodoItem {
  const item: TodoItem = {
    id: generateTodoId(),
    content,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  useTodoStore.getState().appendItem(conversationId, item);
  return item;
}

/**
 * Update a todo item. Accepts either the real id or a 1-based index
 * (LLM sees sequential numbers in the prompt and sometimes passes
 * "1" / "2" instead of the actual todo-xxx id). Returns null if the
 * lookup fails.
 */
export function updateTodo(
  conversationId: string,
  todoId: string,
  updates: { status?: TodoStatus; content?: string },
): TodoItem | null {
  const list = useTodoStore.getState().lists[conversationId];
  if (!list) return null;

  // 1-based index path: resolve to the real id first so the store's
  // patchItem (which uses id internally) hits the right row even if the
  // list has been reordered since the LLM saw it.
  let resolvedId = todoId;
  if (/^\d+$/.test(todoId)) {
    const idx = parseInt(todoId, 10) - 1;
    const hit = list[idx];
    if (!hit) return null;
    resolvedId = hit.id;
  }

  return useTodoStore.getState().patchItem(conversationId, resolvedId, updates);
}

/**
 * Remove a todo item. Supports the same id-or-index convention as
 * updateTodo — LLM might call with "3" expecting 1-based removal.
 */
export function removeTodo(conversationId: string, todoId: string): boolean {
  const list = useTodoStore.getState().lists[conversationId];
  if (!list) return false;

  const index = /^\d+$/.test(todoId)
    ? parseInt(todoId, 10) - 1
    : list.findIndex((t) => t.id === todoId);
  return useTodoStore.getState().removeAt(conversationId, index);
}

/**
 * Replace all todos for a conversation (bulk write, used by
 * `todo_write(action='set')`).
 */
export function setTodos(
  conversationId: string,
  items: Array<{ content: string; status?: TodoStatus }>,
): TodoItem[] {
  const now = Date.now();
  const todos: TodoItem[] = items.map((item) => ({
    id: generateTodoId(),
    content: item.content,
    status: item.status ?? 'pending',
    createdAt: now,
    updatedAt: now,
  }));
  useTodoStore.getState().setList(conversationId, todos);
  return todos;
}

/**
 * Clear all todos for a conversation. Called from chatStore when the
 * conversation is deleted — keeps orphan lists from lingering on disk.
 */
export function clearTodos(conversationId: string): void {
  useTodoStore.getState().clearList(conversationId);
}

/**
 * Format todos as a string for injection into the system prompt.
 */
export function formatTodosForPrompt(conversationId: string): string {
  const todos = getTodos(conversationId);
  if (todos.length === 0) return '';

  const statusEmoji: Record<TodoStatus, string> = {
    pending: '⬜',
    in_progress: '🔄',
    completed: '✅',
    cancelled: '❌',
  };

  const lines = todos.map((t, i) =>
    `${i + 1}. ${statusEmoji[t.status]} [${t.status}] ${t.content}`
  );

  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;

  return `## 当前任务计划 (${completed}/${total} 已完成)\n${lines.join('\n')}`;
}

/**
 * Subscribe to todo state changes. Routed through zustand now, but the
 * public contract is unchanged — caller gets a teardown fn, callback
 * fires on any mutation. Selector narrows to `lists` so unrelated
 * zustand updates (none today, but cheap insurance) don't wake the
 * subscriber.
 */
export function subscribeToTodos(callback: () => void): () => void {
  return useTodoStore.subscribe((state, prev) => {
    if (state.lists !== prev.lists) callback();
  });
}
