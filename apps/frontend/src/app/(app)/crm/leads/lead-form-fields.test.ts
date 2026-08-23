import { emptyLeadForm, leadFormToPayload, leadToFormState } from './lead-form-fields';

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
