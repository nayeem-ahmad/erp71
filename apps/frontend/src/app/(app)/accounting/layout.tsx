'use client';

import { CompactUiProvider } from '@/contexts/CompactUiContext';

type AccountingLayoutProps = Readonly<{ children: React.ReactNode }>;

/** Enables compact density for all accounting module screens. */
export default function AccountingLayout({ children }: AccountingLayoutProps) {
    return <CompactUiProvider density="compact">{children}</CompactUiProvider>;
}