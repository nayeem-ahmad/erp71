'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui';
import {
    IMPORT_WIZARD_STEPS,
    canVisitImportStep,
    prevImportStep,
    type ImportWizardContext,
    type ImportWizardStep,
} from '@/lib/import-wizard';

export function ImportStepper({
    current,
    context,
    onSelect,
}: {
    current: ImportWizardStep;
    context: ImportWizardContext;
    onSelect: (step: ImportWizardStep) => void;
}) {
    const currentIndex = IMPORT_WIZARD_STEPS.findIndex((step) => step.id === current);

    return (
        <ol role="tablist" className="flex items-center gap-1 overflow-x-auto pb-1 text-xs mb-4">
            {IMPORT_WIZARD_STEPS.map((step, index) => {
                const active = step.id === current;
                const allowed = canVisitImportStep(step.id, context);
                const done = index < currentIndex;
                return (
                    <li key={step.id} className="flex items-center gap-1 flex-shrink-0">
                        {index > 0 ? (
                            <span
                                className={`w-6 h-px ${index <= currentIndex ? 'bg-blue-600' : 'bg-gray-200'}`}
                                aria-hidden
                            />
                        ) : null}
                        <button
                            type="button"
                            role="tab"
                            aria-selected={active}
                            disabled={!allowed}
                            onClick={() => {
                                if (allowed) onSelect(step.id);
                            }}
                            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium max-md:min-h-touch ${
                                active
                                    ? 'bg-blue-600 text-white'
                                    : done
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : allowed
                                        ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                        : 'bg-gray-50 text-gray-400'
                            }`}
                        >
                            <span className="tabular-nums">{index + 1}</span>
                            <span className="hidden sm:inline">{step.label}</span>
                        </button>
                    </li>
                );
            })}
        </ol>
    );
}

export function ImportWizardFrame({
    current,
    context,
    onSelect,
    onBack,
    onNext,
    showNext = false,
    nextDisabled = false,
    children,
}: {
    current: ImportWizardStep;
    context: ImportWizardContext;
    onSelect: (step: ImportWizardStep) => void;
    onBack?: () => void;
    onNext?: () => void;
    showNext?: boolean;
    nextDisabled?: boolean;
    children: ReactNode;
}) {
    const previous = prevImportStep(current);
    const back = onBack ?? (previous ? () => onSelect(previous) : undefined);
    return (
        <>
            <ImportStepper current={current} context={context} onSelect={onSelect} />
            {children}
            {back || showNext ? (
                <div className="flex flex-wrap gap-2 mt-4">
                    {back ? (
                        <Button type="button" variant="secondary" onClick={back}>
                            Back
                        </Button>
                    ) : null}
                    {showNext ? (
                        <Button type="button" onClick={onNext} disabled={nextDisabled}>
                            Next
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </>
    );
}
