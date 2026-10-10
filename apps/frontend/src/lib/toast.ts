import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';

/** One follow-up a toast offers, e.g. "Print receipt" after a save. */
export interface ToastAction {
    label: string;
    onClick: () => void;
}

export interface ToastItem {
    id: string;
    type: ToastType;
    message: string;
    duration: number;
    action?: ToastAction;
}

export interface ToastOptions {
    duration?: number;
    action?: ToastAction;
}

/** A bare number is the duration, as it always was. */
function toOptions(options?: number | ToastOptions): ToastOptions {
    return typeof options === 'number' ? { duration: options } : options ?? {};
}

const DEFAULT_DURATION: Record<ToastType, number> = {
    success: 4000,
    error: 6000,
    info: 5000,
};

interface ToastStore {
    toasts: ToastItem[];
    show: (type: ToastType, message: string, options?: number | ToastOptions) => string;
    dismiss: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastStore>((set) => ({
    toasts: [],
    show: (type, message, options) => {
        const id = String(++nextId);
        const { duration, action } = toOptions(options);
        set((state) => ({
            toasts: [
                ...state.toasts,
                {
                    id,
                    type,
                    message,
                    // A toast that offers something stays long enough to take it.
                    duration: duration ?? (action ? DEFAULT_DURATION[type] * 2 : DEFAULT_DURATION[type]),
                    ...(action ? { action } : {}),
                },
            ],
        }));
        return id;
    },
    dismiss: (id) => {
        set((state) => ({
            toasts: state.toasts.filter((item) => item.id !== id),
        }));
    },
}));

/** Imperative toast API — auto-dismisses; no OK button required. */
export const toast = {
    success: (message: string, options?: number | ToastOptions) =>
        useToastStore.getState().show('success', message, options),
    error: (message: string, options?: number | ToastOptions) =>
        useToastStore.getState().show('error', message, options),
    info: (message: string, options?: number | ToastOptions) =>
        useToastStore.getState().show('info', message, options),
};