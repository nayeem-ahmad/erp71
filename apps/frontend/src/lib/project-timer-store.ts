import { create } from 'zustand';
import type { RunningTimer } from '@/components/projects/hour-log-day';

/**
 * The one running clock, shared by everything that can see it.
 *
 * It is a store rather than page state because the tracker now floats over the
 * whole app: the panel in the layout and the hour log underneath it are looking
 * at the same timer, and a clock stopped from the panel has to reach the list
 * that is showing the hours it just wrote.
 */
interface ProjectTimerStore {
    timer: RunningTimer | null;
    /** False until the first `GET /project-time/timer` has answered. */
    loaded: boolean;
    /** True while a start/stop/log is in flight, so a double press cannot double-write. */
    busy: boolean;
    /**
     * Whether the panel is showing when nothing is running. A running clock
     * shows it regardless — that is the point of the thing.
     */
    open: boolean;
    /** Bumped whenever a write changed logged hours, so open lists can refetch. */
    revision: number;
    setTimer: (timer: RunningTimer | null) => void;
    setBusy: (busy: boolean) => void;
    setOpen: (open: boolean) => void;
    bumpRevision: () => void;
}

export const useProjectTimerStore = create<ProjectTimerStore>((set) => ({
    timer: null,
    loaded: false,
    busy: false,
    open: false,
    revision: 0,
    setTimer: (timer) => set({ timer, loaded: true }),
    setBusy: (busy) => set({ busy }),
    setOpen: (open) => set({ open }),
    bumpRevision: () => set((state) => ({ revision: state.revision + 1 })),
}));
