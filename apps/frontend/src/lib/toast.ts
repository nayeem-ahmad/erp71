import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
    id: string;
    type: ToastType;
    message: string;
    duration: number;
}

const DEFAULT_DURATION: Record<ToastType, number> = {
    success: 4000,
    error: 6000,
    info: 5000,
};

interface ToastStore {
    toasts: ToastItem[];
    show: (type: ToastType, message: string, duration?: number) => string;
    dismiss: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastStore>((set) => ({
    toasts: [],
    show: (type, message, duration) => {
        const id = String(++nextId);
        set((state) => ({
            toasts: [
                ...state.toasts,
                {
                    id,
                    type,
                    message,
                    duration: duration ?? DEFAULT_DURATION[type],
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
    success: (message: string, duration?: number) =>
        useToastStore.getState().show('success', message, duration),
    error: (message: string, duration?: number) =>
        useToastStore.getState().show('error', message, duration),
    info: (message: string, duration?: number) =>
        useToastStore.getState().show('info', message, duration),
};