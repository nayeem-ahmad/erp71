'use client';

import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { TaskCard } from './useTaskCard';

/**
 * Watch the task, or stop watching it.
 *
 * In the card's header now rather than inside its comment feed: it is the task
 * that is watched — moves, reassignments and comments all notify — and a
 * button only reachable by opening the Comments tab hid that. The flag comes
 * with the task read, so showing it costs no request.
 *
 * `iconOnly` for the modal's header, where it sits beside the other icon
 * buttons; the page has room for the word, and for how many people watch.
 */
export default function WatchButton({ card, iconOnly = false }: { card: TaskCard; iconOnly?: boolean }) {
    const { t } = useI18n();
    const m = t.projects.activity;
    const { watching, watchBusy, toggleWatch } = card;
    const count = card.task?._count?.watchers ?? 0;
    const label = watching ? m.watching : m.watch;

    if (iconOnly) {
        // Without a word beside it, the icon itself has to carry the state —
        // colour alone is not enough to tell watching from not.
        const Icon = watching ? Eye : EyeOff;
        return (
            <button
                type="button"
                aria-label={label}
                aria-pressed={watching}
                title={m.watchHint}
                disabled={watchBusy}
                onClick={() => void toggleWatch()}
                className={`rounded-md p-2 transition-colors disabled:opacity-60 ${
                    watching
                        ? 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                        : 'text-gray-400 hover:bg-gray-100 hover:text-blue-600'
                }`}
            >
                <Icon className="h-4 w-4" aria-hidden />
            </button>
        );
    }

    return (
        <Button
            type="button"
            variant={watching ? 'tinted' : 'secondary'}
            aria-pressed={watching}
            title={m.watchHint}
            disabled={watchBusy}
            onClick={() => void toggleWatch()}
        >
            <Eye className="h-4 w-4" aria-hidden />
            {label}
            {count > 0 && (
                <span
                    className={`rounded-full px-1.5 text-[11px] font-medium tabular-nums ${
                        watching ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                    }`}
                >
                    {count}
                </span>
            )}
        </Button>
    );
}
