'use client';

import { Coins, QrCode, Store } from 'lucide-react';

export type GettingStartedLabels = {
    title: string;
    subtitle: string;
    steps: {
        share: { title: string; body: string };
        signup: { title: string; body: string };
        earn: { title: string; body: string };
    };
};

const ICONS = [QrCode, Store, Coins] as const;

/**
 * What a brand-new partner sees instead of nine ৳0 tiles and three empty charts.
 *
 * A dashboard is a reading of something that happened. Before anything has, it is
 * a wall of zeros that teaches nothing, so the dashboard waits until there is
 * something to read and this explains the shape of the deal in the meantime.
 */
export default function GettingStarted({ labels }: { labels: GettingStartedLabels }) {
    const steps = [labels.steps.share, labels.steps.signup, labels.steps.earn];

    return (
        <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm md:p-6">
            <h2 className="text-base font-semibold text-gray-900">{labels.title}</h2>
            <p className="mt-1 text-sm text-gray-500">{labels.subtitle}</p>

            <ol className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                {steps.map((step, index) => {
                    const Icon = ICONS[index];
                    return (
                        <li
                            key={step.title}
                            className="rounded-lg border border-gray-100 bg-gray-50 p-4"
                        >
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                                <Icon className="h-5 w-5" aria-hidden="true" />
                            </div>
                            <p className="mt-3 text-sm font-semibold text-gray-900">{step.title}</p>
                            <p className="mt-1 text-xs leading-relaxed text-gray-600">{step.body}</p>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
