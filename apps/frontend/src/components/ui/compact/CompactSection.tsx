'use client';

import type { ReactNode } from 'react';
import { compactDensity } from '@/lib/ui/compact-density';

type CompactSectionProps = {
    children: ReactNode;
    title?: string;
    className?: string;
    flat?: boolean;
};

export default function CompactSection({
    children,
    title,
    className = '',
    flat = false,
}: CompactSectionProps) {
    return (
        <section className={`${flat ? compactDensity.cardFlat : compactDensity.card} ${className}`}>
            {title ? <p className={`${compactDensity.sectionLabel} mb-2`}>{title}</p> : null}
            {children}
        </section>
    );
}