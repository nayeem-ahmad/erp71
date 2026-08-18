import {
    emptyLeadForm,
    leadFormToPayload,
    type LeadFormState,
} from './lead-form-fields';

function formWithNextStep(overrides: Partial<LeadFormState> = {}): LeadFormState {
    return {
        ...emptyLeadForm(),
        name: 'Karim Traders',
        next_step: 'Call back Thursday',
        next_step_date: '2026-09-01T10:00',
        next_step_assigned_to: 'user-9',
        source: 'src-1',
        category: 'cat-1',
        ...overrides,
    };
}

describe('leadFormToPayload', () => {
    it('includes next_step fields on create so a new lead can open with a planned activity', () => {
        const payload = leadFormToPayload(formWithNextStep());

        expect(payload.next_step).toBe('Call back Thursday');
        expect(payload.next_step_date).toBe(new Date('2026-09-01T10:00').toISOString());
        expect(payload.next_step_assigned_to).toBe('user-9');
    });

    it('omits next_step fields on update so ValidationPipe does not reject the save', () => {
        const payload = leadFormToPayload(formWithNextStep(), { mode: 'update' });

        expect(payload).not.toHaveProperty('next_step');
        expect(payload).not.toHaveProperty('next_step_date');
        expect(payload).not.toHaveProperty('next_step_assigned_to');
        expect(payload.name).toBe('Karim Traders');
        expect(payload.source).toBe('src-1');
        expect(payload.category).toBe('cat-1');
    });
});
