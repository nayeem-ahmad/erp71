'use client';

import {
    CAREERS_STAGE_LABELS,
    careersStageTone,
    type CareersApplicationStage,
} from '@erp71/shared-types';

/**
 * Semantic tones only — emerald for success, amber for warning, red for danger,
 * blue for informational, per the platform's colour rules.
 */
const toneClass: Record<ReturnType<typeof careersStageTone>, string> = {
    neutral: 'bg-gray-100 text-gray-700',
    info: 'bg-blue-50 text-blue-700',
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-700',
};

export default function StageChip({ stage }: { stage: CareersApplicationStage }) {
    return (
        <span
            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${toneClass[careersStageTone(stage)]}`}
        >
            {CAREERS_STAGE_LABELS[stage]}
        </span>
    );
}
