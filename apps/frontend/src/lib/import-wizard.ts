export const IMPORT_WIZARD_STEPS = [
    { id: 'connection', label: 'Connection' },
    { id: 'extract', label: 'Extract / Upload' },
    { id: 'mapping', label: 'Mapping Decisions' },
    { id: 'import', label: 'Import' },
] as const;

export type ImportWizardStep = (typeof IMPORT_WIZARD_STEPS)[number]['id'];

export type ImportWizardContext = {
    hasConnection: boolean;
    hasReadySnapshot: boolean;
    matchesConfirmed: boolean;
};

export function canVisitImportStep(step: ImportWizardStep, ctx: ImportWizardContext): boolean {
    if (step === 'connection') return true;
    if (!ctx.hasConnection) return false;
    if (step === 'extract') return true;
    if (!ctx.hasReadySnapshot) return false;
    if (step === 'mapping') return true;
    return ctx.matchesConfirmed;
}

export function canAdvanceImportStep(step: ImportWizardStep, ctx: ImportWizardContext): boolean {
    if (step === 'connection') return ctx.hasConnection;
    if (step === 'extract') return ctx.hasReadySnapshot;
    if (step === 'mapping') return ctx.matchesConfirmed;
    return false;
}

export function initialImportStep(ctx: ImportWizardContext): ImportWizardStep {
    return ctx.hasConnection ? 'extract' : 'connection';
}

export function nextImportStep(step: ImportWizardStep): ImportWizardStep | null {
    const index = IMPORT_WIZARD_STEPS.findIndex((item) => item.id === step);
    return IMPORT_WIZARD_STEPS[index + 1]?.id ?? null;
}

export function prevImportStep(step: ImportWizardStep): ImportWizardStep | null {
    const index = IMPORT_WIZARD_STEPS.findIndex((item) => item.id === step);
    return IMPORT_WIZARD_STEPS[index - 1]?.id ?? null;
}
