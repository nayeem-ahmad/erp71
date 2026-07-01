'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { UiDensity } from '@/lib/ui/compact-density';

type CompactUiContextValue = {
    density: UiDensity;
    isCompact: boolean;
};

const CompactUiContext = createContext<CompactUiContextValue>({
    density: 'comfortable',
    isCompact: false,
});

export function CompactUiProvider({
    density,
    children,
}: {
    density: UiDensity;
    children: ReactNode;
}) {
    return (
        <CompactUiContext.Provider value={{ density, isCompact: density === 'compact' }}>
            {children}
        </CompactUiContext.Provider>
    );
}

export function useCompactUi() {
    return useContext(CompactUiContext);
}