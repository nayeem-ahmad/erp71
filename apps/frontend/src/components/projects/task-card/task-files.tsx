'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import type { TaskCard } from './useTaskCard';

type Strip = (keys: Set<string>) => void;

type TaskFiles = {
    /** Bumped whenever the attachment inventory changes, so an open list reloads. */
    revision: number;
    /** Moves the tab's count by `delta` and asks the list to reload. */
    bump: (delta: number) => void;
    registerDescriptionStrip: (fn: Strip | null) => void;
    /** Takes images out of a description that is open for editing. */
    stripDescriptionDraft: (keys: Set<string>) => void;
};

const TaskFilesContext = createContext<TaskFiles | null>(null);

/**
 * Shares the attachment inventory across the description, the comments and the
 * Attachments tab.
 *
 * A paste in the description has to move the tab's count, and removing a file
 * from the tab has to take it out of a description that is open. The three
 * sections do not otherwise know about each other.
 */
export function TaskFilesProvider({ card, children }: { card: TaskCard; children: ReactNode }) {
    const [revision, setRevision] = useState(0);
    const alive = useRef(true);
    const strip = useRef<Strip | null>(null);
    const adjust = card.adjustAttachmentCount;

    useEffect(
        () => () => {
            alive.current = false;
        },
        [],
    );

    const bump = useCallback(
        (delta: number) => {
            if (!alive.current) return;
            if (delta !== 0) adjust(delta);
            setRevision((current) => current + 1);
        },
        [adjust],
    );

    const registerDescriptionStrip = useCallback((fn: Strip | null) => {
        strip.current = fn;
    }, []);

    const stripDescriptionDraft = useCallback((keys: Set<string>) => {
        strip.current?.(keys);
    }, []);

    const value = useMemo(
        () => ({ revision, bump, registerDescriptionStrip, stripDescriptionDraft }),
        [revision, bump, registerDescriptionStrip, stripDescriptionDraft],
    );

    return <TaskFilesContext.Provider value={value}>{children}</TaskFilesContext.Provider>;
}

const FALLBACK: TaskFiles = {
    revision: 0,
    bump: () => {},
    registerDescriptionStrip: () => {},
    stripDescriptionDraft: () => {},
};

export function useTaskFiles(): TaskFiles {
    return useContext(TaskFilesContext) ?? FALLBACK;
}
