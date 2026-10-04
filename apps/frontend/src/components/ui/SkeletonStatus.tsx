'use client';

import { useI18n } from '@/lib/i18n';

/**
 * The word a screen reader announces in place of a skeleton, which a pulse
 * means nothing to.
 *
 * The only client piece of `PageSkeleton`: the dictionary lives in React
 * context, which a server component cannot read. It costs next to nothing —
 * `@/lib/i18n` is in every page's shared chunk already — and it cannot suspend
 * inside a loading fallback, because `I18nProvider` is what waits for the
 * dictionary, not `useI18n`.
 */
export default function SkeletonStatus() {
    const { t } = useI18n();
    return (
        <p role="status" className="sr-only">
            {t.common.loading}
        </p>
    );
}
