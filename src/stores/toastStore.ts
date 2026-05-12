import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
  duration?: number;
  actions?: ToastAction[];
}

interface ToastState {
  toasts: Toast[];
}

interface ToastActions {
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export type ToastStore = ToastState & ToastActions;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

// Track timeout IDs so we can clear them when toasts are manually removed
const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastStore>()(
  immer((set) => ({
    toasts: [],

    addToast: (toast) => {
      const id = generateId();
      // Actionable toasts get longer duration by default
      const duration = toast.duration ?? (toast.actions ? 10000 : 3000);

      set((state) => {
        state.toasts.push({ ...toast, id });
      });

      // Auto-remove after duration (0 = no auto-remove)
      if (duration > 0) {
        const timeoutId = setTimeout(() => {
          toastTimeouts.delete(id);
          set((state) => {
            state.toasts = state.toasts.filter((t) => t.id !== id);
          });
        }, duration);
        toastTimeouts.set(id, timeoutId);
      }
    },

    removeToast: (id) => {
      // Clear the auto-remove timeout if toast is manually dismissed
      const timeoutId = toastTimeouts.get(id);
      if (timeoutId) {
        clearTimeout(timeoutId);
        toastTimeouts.delete(id);
      }
      set((state) => {
        state.toasts = state.toasts.filter((t) => t.id !== id);
      });
    },
  }))
);
