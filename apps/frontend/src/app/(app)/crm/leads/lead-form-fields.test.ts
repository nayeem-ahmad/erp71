import { emptyLeadForm, leadFormToPayload, leadToFormState, setLeadOwner } from './lead-form-fields';

describe('lead photo fields', () => {
    it('starts empty', () => {
        const form = emptyLeadForm();
        expect(form.photo_url).toBe('');
        expect(form.photo_storage_key).toBe('');
    });

    it('reads both fields off a saved lead', () => {
        const form = leadToFormState({
            name: 'Rahim',
            photo_url: 'https://cdn.example/rahim.jpg',
            photo_storage_key: 'retail/tenant-1/crm-photos/rahim',
        });
        expect(form.photo_url).toBe('https://cdn.example/rahim.jpg');
        expect(form.photo_storage_key).toBe('retail/tenant-1/crm-photos/rahim');
    });

    it('treats a lead with no photo as empty strings, not "null"', () => {
        const form = leadToFormState({ name: 'Rahim', photo_url: null });
        expect(form.photo_url).toBe('');
        expect(form.photo_storage_key).toBe('');
    });

    it('sends both fields in the payload', () => {
        const payload = leadFormToPayload({
            ...emptyLeadForm(),
            name: 'Rahim',
            photo_url: 'https://cdn.example/rahim.jpg',
            photo_storage_key: 'retail/tenant-1/crm-photos/rahim',
        });
        expect(payload.photo_url).toBe('https://cdn.example/rahim.jpg');
        expect(payload.photo_storage_key).toBe('retail/tenant-1/crm-photos/rahim');
    });

    it('sends blanks when the photo was removed, so the backend clears it', () => {
        const payload = leadFormToPayload({ ...emptyLeadForm(), name: 'Rahim' });
        expect(payload.photo_url).toBe('');
        expect(payload.photo_storage_key).toBe('');
    });

    it('still sends the photo on an update, where next_step* are omitted', () => {
        const payload = leadFormToPayload(
            { ...emptyLeadForm(), name: 'Rahim', next_step: 'Call', photo_url: 'https://cdn.example/r.jpg' },
            { mode: 'update' },
        );
        expect(payload.next_step).toBeUndefined();
        expect(payload.photo_url).toBe('https://cdn.example/r.jpg');
    });
});

describe('lead owner', () => {
    it('starts unassigned', () => {
        expect(emptyLeadForm().assigned_to).toBe('');
    });

    it('reads the owner off a saved lead', () => {
        const form = leadToFormState({ name: 'Rahim', assigned_to: 'user-9' });
        expect(form.assigned_to).toBe('user-9');
    });

    it('treats an unowned lead as an empty string, not "null"', () => {
        const form = leadToFormState({ name: 'Rahim', assigned_to: null });
        expect(form.assigned_to).toBe('');
    });

    it('sends the owner unconditionally, so a lead can be unassigned', () => {
        const payload = leadFormToPayload({ ...emptyLeadForm(), name: 'Rahim' });
        expect(payload.assigned_to).toBe('');
    });

    it('still sends the owner on an update, where next_step* are omitted', () => {
        const payload = leadFormToPayload(
            { ...emptyLeadForm(), name: 'Rahim', assigned_to: 'user-9', next_step: 'Call' },
            { mode: 'update' },
        );
        expect(payload.next_step).toBeUndefined();
        expect(payload.assigned_to).toBe('user-9');
    });

    it('drags the next-step assignee along while it still matches the owner', () => {
        const form = setLeadOwner({ ...emptyLeadForm(), assigned_to: 'user-1', next_step_assigned_to: 'user-1' }, 'user-2');
        expect(form.assigned_to).toBe('user-2');
        expect(form.next_step_assigned_to).toBe('user-2');
    });

    it('leaves a deliberately different next-step assignee alone', () => {
        const form = setLeadOwner({ ...emptyLeadForm(), assigned_to: 'user-1', next_step_assigned_to: 'user-7' }, 'user-2');
        expect(form.assigned_to).toBe('user-2');
        expect(form.next_step_assigned_to).toBe('user-7');
    });
});

describe('lead address', () => {
    it('starts empty', () => {
        expect(emptyLeadForm().address).toBe('');
    });

    it('reads the address off a saved lead', () => {
        const form = leadToFormState({ name: 'Rahim', address: '12 Gulshan Ave, Dhaka' });
        expect(form.address).toBe('12 Gulshan Ave, Dhaka');
    });

    it('treats a lead with no address as an empty string, not "null"', () => {
        expect(leadToFormState({ name: 'Rahim', address: null }).address).toBe('');
    });

    it('sends the trimmed address unconditionally, so it can be cleared', () => {
        expect(leadFormToPayload({ ...emptyLeadForm(), name: 'Rahim', address: '  12 Gulshan Ave  ' }).address)
            .toBe('12 Gulshan Ave');
        expect(leadFormToPayload({ ...emptyLeadForm(), name: 'Rahim' }).address).toBe('');
    });
});
