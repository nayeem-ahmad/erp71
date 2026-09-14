'use client';

import type { ReactNode } from 'react';
import { compactDensity } from '@/lib/ui/compact-density';
import type { BreadcrumbItem } from '@/lib/page-breadcrumbs';
import PageBreadcrumb from './PageBreadcrumb';

type PageHeaderProps = {
    title: ReactNode;
    subtitle?: ReactNode;
    breadcrumbs?: BreadcrumbItem[];
    actions?: ReactNode;
    className?: string;
};

/** Page title block — title/subtitle on the left, breadcrumb (and optional actions) on the right. */
export default function PageHeader({
    title,
    subtitle,
    breadcrumbs,
    actions,
    className = '',
}: PageHeaderProps) {
    const hasBreadcrumbs = Boolean(breadcrumbs?.length);
    const hasActions = Boolean(actions);

    if (!title && !subtitle && !hasBreadcrumbs && !hasActions) return null;

    return (
        <div className={`flex flex-col gap-3 ${className}`}>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                    {title ? (
                        <h1 className={compactDensity.pageTitle}>{title}</h1>
                    ) : null}
                    {subtitle ? (
                        <p className={`${compactDensity.pageSubtitle} mt-0.5`}>{subtitle}</p>
                    ) : null}
                </div>

                {(hasBreadcrumbs || hasActions) ? (
                    /* `flex-shrink-0` used to sit here beside `min-w-0`, which
                       cancel each other out: a column that may not shrink lays
                       out at its natural content width whatever its minimum,
                       so on a narrow screen it overflowed the row instead of
                       wrapping — 898px wide inside a 360px viewport, clipping
                       whatever sat furthest right. Harmless while `actions`
                       held two or three buttons, which is why it survived; it
                       bites the moment a page puts a real row of controls
                       there. Shrinking is what lets the nested `flex-wrap`
                       below find a boundary to break against. */
                    <div className="flex min-w-0 flex-col items-end gap-2">
                        {hasBreadcrumbs ? <PageBreadcrumb items={breadcrumbs!} /> : null}
                        {hasActions ? (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                {actions}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
}