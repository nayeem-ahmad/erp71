import {
    IMPORT_WIZARD_STEPS,
    canAdvanceImportStep,
    canVisitImportStep,
    initialImportStep,
    nextImportStep,
    prevImportStep,
    type ImportWizardContext,
} from './import-wizard';

const empty: ImportWizardContext = {
    hasConnection: false,
    hasReadySnapshot: false,
    matchesConfirmed: false,
};

describe('IMPORT_WIZARD_STEPS', () => {
    it('lists the four import stages in order', () => {
        expect(IMPORT_WIZARD_STEPS.map((step) => step.label)).toEqual([
            'Connection',
            'Extract / Upload',
            'Mapping Decisions',
            'Import',
        ]);
    });
});

describe('canVisitImportStep', () => {
    it('lets Connection always be opened', () => {
        expect(canVisitImportStep('connection', empty)).toBe(true);
    });

    it('requires a saved connection before Extract / Upload', () => {
        expect(canVisitImportStep('extract', empty)).toBe(false);
        expect(canVisitImportStep('extract', { ...empty, hasConnection: true })).toBe(true);
    });

    it('requires a ready snapshot before Mapping Decisions', () => {
        expect(canVisitImportStep('mapping', { ...empty, hasConnection: true })).toBe(false);
        expect(
            canVisitImportStep('mapping', { ...empty, hasConnection: true, hasReadySnapshot: true }),
        ).toBe(true);
    });

    it('requires confirmed matches before Import', () => {
        expect(
            canVisitImportStep('import', { ...empty, hasConnection: true, hasReadySnapshot: true }),
        ).toBe(false);
        expect(
            canVisitImportStep('import', {
                hasConnection: true,
                hasReadySnapshot: true,
                matchesConfirmed: true,
            }),
        ).toBe(true);
    });
});

describe('canAdvanceImportStep', () => {
    it('advances from Connection once a connection is saved', () => {
        expect(canAdvanceImportStep('connection', empty)).toBe(false);
        expect(canAdvanceImportStep('connection', { ...empty, hasConnection: true })).toBe(true);
    });

    it('advances from Extract once a ready snapshot is selected', () => {
        expect(canAdvanceImportStep('extract', { ...empty, hasConnection: true })).toBe(false);
        expect(
            canAdvanceImportStep('extract', { ...empty, hasConnection: true, hasReadySnapshot: true }),
        ).toBe(true);
    });

    it('advances from Mapping once matches are confirmed', () => {
        expect(
            canAdvanceImportStep('mapping', { ...empty, hasConnection: true, hasReadySnapshot: true }),
        ).toBe(false);
        expect(
            canAdvanceImportStep('mapping', {
                hasConnection: true,
                hasReadySnapshot: true,
                matchesConfirmed: true,
            }),
        ).toBe(true);
    });

    it('does not advance past Import', () => {
        expect(
            canAdvanceImportStep('import', {
                hasConnection: true,
                hasReadySnapshot: true,
                matchesConfirmed: true,
            }),
        ).toBe(false);
    });
});

describe('initialImportStep', () => {
    it('opens on Extract / Upload when a connection already exists', () => {
        expect(initialImportStep({ ...empty, hasConnection: true })).toBe('extract');
    });

    it('opens on Connection when nothing is saved yet', () => {
        expect(initialImportStep(empty)).toBe('connection');
    });
});

describe('nextImportStep / prevImportStep', () => {
    it('walks forward and back through the four steps', () => {
        expect(nextImportStep('connection')).toBe('extract');
        expect(nextImportStep('extract')).toBe('mapping');
        expect(nextImportStep('mapping')).toBe('import');
        expect(nextImportStep('import')).toBeNull();
        expect(prevImportStep('import')).toBe('mapping');
        expect(prevImportStep('mapping')).toBe('extract');
        expect(prevImportStep('extract')).toBe('connection');
        expect(prevImportStep('connection')).toBeNull();
    });
});
