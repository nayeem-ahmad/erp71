'use client';

import type { ReactNode } from 'react';
import { compactDensity } from '@/lib/ui/compact-density';
import type { BreadcrumbItem } from '@/lib/page-breadcrumbs';
import { useUiStyle } from '@/lib/ui-theme';
import PageBreadcrumb from './PageBreadcrumb';
import PageTimingBadge from '@/components/page-timing/PageTimingBadge';
import { usePageTimingViewer } from '@/lib/page-timing/viewer';

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
    const { polished } = useUiStyle();
    const hasBreadcrumbs = Boolean(breadcrumbs?.length);
    const hasActions = Boolean(actions);
    // Platform staff who switched page timing on see the load time on the far
    // side of the header. Off for everyone else, and then the layout is untouched.
    const showTiming = usePageTimingViewer().visible;

    if (!title && !subtitle && !hasBreadcrumbs && !hasActions) return null;

    if (polished) {
        // Breadcrumb above the title, so the far side of the row holds only actions.
        // Hidden on a phone: the sidebar already says where you are.
        return (
            <div className={`flex flex-col gap-1 ${className}`}>
                {hasBreadcrumbs ? (
                    <PageBreadcrumb items={breadcrumbs!} variant="compact" className="hidden md:flex" />
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                        {title ? (
                            <h1 className="text-xl font-semibold tracking-tight text-gray-950">{title}</h1>
                        ) : null}
                        {subtitle ? (
                            <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>
                        ) : null}
                    </div>
                    {hasActions || showTiming ? (
                        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                            {showTiming ? <PageTimingBadge /> : null}
                            {actions}
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }

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

                {(hasBreadcrumbs || hasActions || showTiming) ? (
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
                        {showTiming ? (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <PageTimingBadge />
                                {hasBreadcrumbs ? <PageBreadcrumb items={breadcrumbs!} /> : null}
                            </div>
                        ) : hasBreadcrumbs ? (
                            <PageBreadcrumb items={breadcrumbs!} />
                        ) : null}
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