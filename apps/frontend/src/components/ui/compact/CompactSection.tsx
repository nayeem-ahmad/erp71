'use client';

import type { ReactNode } from 'react';
import { compactDensity } from '@/lib/ui/compact-density';

type CompactSectionProps = {
    children: ReactNode;
    title?: ReactNode;
    className?: string;
    flat?: boolean;
    /**
     * Controls at the far end of the title row: an Add button, a count, an
     * Edit link. Absent, the title renders exactly as it always has.
     */
    actions?: ReactNode;
    /**
     * `label`, the default, is the small grey caption dashboards put above a
     * figure. `heading` makes the title a real heading at the section-title
     * size of `docs/ui-design-guidelines.md` §2.3, for a card whose title names
     * what is in it and that a screen reader should be able to jump between.
     */
    titleStyle?: 'label' | 'heading';
    /** The heading's level when `titleStyle` is `heading`. */
    headingLevel?: 2 | 3;
    id?: string;
    'aria-labelledby'?: string;
};

export default function CompactSection({
    children,
    title,
    className = '',
    flat = false,
    actions,
    titleStyle = 'label',
    headingLevel = 2,
    id,
    'aria-labelledby': labelledBy,
}: CompactSectionProps) {
    const Heading = headingLevel === 3 ? 'h3' : 'h2';
    const titleNode = title ? (
        titleStyle === 'heading' ? (
            <Heading className="text-sm font-semibold text-gray-900">{title}</Heading>
        ) : (
            <p className={compactDensity.sectionLabel}>{title}</p>
        )
    ) : null;

    return (
        <section
            id={id}
            aria-labelledby={labelledBy}
            className={`${flat ? compactDensity.cardFlat : compactDensity.card} ${className}`}
        >
            {actions ? (
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-baseline gap-2">{titleNode}</div>
                    <div className="flex shrink-0 items-center gap-2">{actions}</div>
                </div>
            ) : titleStyle === 'heading' && titleNode ? (
                <div className="mb-2">{titleNode}</div>
            ) : title ? (
                <p className={`${compactDensity.sectionLabel} mb-2`}>{title}</p>
            ) : null}
            {children}
        </section>
    );
}
