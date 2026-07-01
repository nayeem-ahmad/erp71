'use client';

import type { ReactNode } from 'react';
import { HelpTooltip } from '@/components/HelpTooltip';
import { compactDensity } from '@/lib/ui/compact-density';

type PageToolbarProps = {
    help?: string;
    subtitle?: string;
    actions?: ReactNode;
    children?: ReactNode;
};

/** Slim action bar — page title lives in the app header when configured. */
export default function PageToolbar({
    help,
    subtitle,
    actions,
    children,
}: PageToolbarProps) {
    if (!actions && !children && !subtitle && !help) return null;

    return (
        <div className="space-y-2">
            {(actions || help || subtitle) && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        {help ? <HelpTooltip text={help} /> : null}
                        {subtitle ? (
                            <p className={`${compactDensity.pageSubtitle} truncate`}>{subtitle}</p>
                        ) : null}
                    </div>
                    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
                </div>
            )}
            {children}
        </div>
    );
}