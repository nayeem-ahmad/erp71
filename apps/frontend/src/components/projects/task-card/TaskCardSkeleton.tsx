'use client';

import { useI18n } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';

/** One grey bar of the placeholder, at the width a line of text would be. */
function Bar({ width }: { width: string }) {
    return <div className={`h-3 animate-pulse rounded bg-gray-100 ${width}`} />;
}

/**
 * The card's shape while its task loads, so the page does not jump from one
 * line of "Loading…" to a full layout. Same grid as `TaskCardBody` for each
 * presentation, so the cards land where their placeholders were.
 *
 * The word is still there for a screen reader, which a pulse means nothing to.
 */
export default function TaskCardSkeleton({ presentation = 'modal' }: { presentation?: 'modal' | 'page' }) {
    const { t } = useI18n();
    const page = presentation === 'page';

    return (
        <div
            aria-busy="true"
            className={`grid grid-cols-1 gap-4 ${page ? 'lg:grid-cols-[minmax(0,1fr)_20rem]' : 'md:grid-cols-3'}`}
        >
            <p className="sr-only">{t.common.loading}</p>
            <div
                aria-hidden
                className={`min-w-0 space-y-4 ${page ? 'lg:col-start-2 lg:row-start-1' : 'md:col-start-3 md:row-start-1'}`}
            >
                <div className={`${compactDensity.card} space-y-3`}>
                    <Bar width="w-20" />
                    {['w-3/4', 'w-2/3', 'w-1/2', 'w-3/5', 'w-2/3', 'w-1/2'].map((width, index) => (
                        <Bar key={index} width={width} />
                    ))}
                </div>
                <div className={`${compactDensity.card} space-y-3`}>
                    <Bar width="w-16" />
                    <div className="grid grid-cols-3 gap-2">
                        {[0, 1, 2].map((index) => (
                            <div key={index} className="h-12 animate-pulse rounded-md bg-gray-100" />
                        ))}
                    </div>
                </div>
            </div>
            <div
                aria-hidden
                className={`min-w-0 space-y-4 ${page ? 'lg:col-start-1 lg:row-start-1' : 'md:col-span-2 md:col-start-1 md:row-start-1'}`}
            >
                <div className={`${compactDensity.card} space-y-3`}>
                    <Bar width="w-24" />
                    <Bar width="w-full" />
                    <Bar width="w-11/12" />
                    <Bar width="w-2/3" />
                </div>
                <div className={`${compactDensity.card} space-y-3`}>
                    <Bar width="w-20" />
                    <Bar width="w-1/2" />
                    <Bar width="w-2/5" />
                </div>
            </div>
        </div>
    );
}
