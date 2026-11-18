'use client';

import { useI18n } from '@/lib/i18n';

/**
 * The 0–10 "how likely are you to recommend" scale, as a radio group of eleven
 * buttons. Shared by the customer receipt survey and the owner question so
 * both look and read the same.
 */
export default function NpsScorePicker({
    value,
    onChange,
    labelledBy,
}: {
    value: number | null;
    onChange: (score: number) => void;
    labelledBy: string;
}) {
    const { t, fmt } = useI18n();
    const copy = t.kpis.survey;
    return (
        <div>
            <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
                {Array.from({ length: 11 }, (_, score) => {
                    const selected = value === score;
                    return (
                        <button
                            key={score}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={fmt(copy.scoreLabel, { score })}
                            onClick={() => onChange(score)}
                            className={`min-h-touch rounded-md border text-sm font-medium tabular-nums transition-colors ${
                                selected
                                    ? 'border-blue-600 bg-blue-600 text-white'
                                    : 'border-gray-200 bg-white text-gray-700 hover:border-blue-600'
                            }`}
                        >
                            {score}
                        </button>
                    );
                })}
            </div>
            <div className="mt-1 flex justify-between text-xs text-gray-500">
                <span>{copy.scaleLow}</span>
                <span>{copy.scaleHigh}</span>
            </div>
        </div>
    );
}
