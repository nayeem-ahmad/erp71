import { useSyncExternalStore } from 'react';

/**
 * Whether this viewer sees the page-timing badge: platform staff only (the
 * app shell says who is), and only once they switch it on in the avatar menu.
 * The switch is kept per device.
 */

const STORAGE_KEY = 'erp71:page-timing-visible';

let isStaff = false;
let switchedOn: boolean | null = null;
const listeners = new Set<() => void>();

function readSwitch(): boolean {
    if (switchedOn === null) {
        try {
            switchedOn = typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === '1';
        } catch {
            switchedOn = false;
        }
    }
    return switchedOn;
}

function emit() {
    for (const listener of listeners) listener();
}

export function setPageTimingViewerIsStaff(value: boolean): void {
    if (isStaff === value) return;
    isStaff = value;
    emit();
}

export function setPageTimingSwitchedOn(value: boolean): void {
    switchedOn = value;
    try {
        window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch {
        // Private mode: it holds for this tab.
    }
    emit();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export type PageTimingViewer = { isStaff: boolean; switchedOn: boolean; visible: boolean };

let snapshot: PageTimingViewer = { isStaff: false, switchedOn: false, visible: false };
function getSnapshot(): PageTimingViewer {
    const on = readSwitch();
    if (snapshot.isStaff !== isStaff || snapshot.switchedOn !== on) {
        snapshot = { isStaff, switchedOn: on, visible: isStaff && on };
    }
    return snapshot;
}

const serverSnapshot: PageTimingViewer = { isStaff: false, switchedOn: false, visible: false };

export function usePageTimingViewer(): PageTimingViewer {
    return useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
}

/** Tests only. */
export function resetPageTimingViewerForTests(): void {
    isStaff = false;
    switchedOn = null;
    snapshot = { isStaff: false, switchedOn: false, visible: false };
}
