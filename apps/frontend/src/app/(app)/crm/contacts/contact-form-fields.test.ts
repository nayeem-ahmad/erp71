import {
    applyScannedCard,
    contactFormToPayload,
    contactToFormState,
    emptyContactForm,
    validateContactForm,
} from './contact-form-fields';

const MESSAGES = { nameRequired: 'Name is required.', invalidEmail: 'Invalid email.' };

describe('validateContactForm', () => {
    it('requires a name that is not just whitespace', () => {
        expect(validateContactForm({ ...emptyContactForm(), name: '   ' }, MESSAGES)).toEqual({
            name: MESSAGES.nameRequired,
        });
    });

    it('accepts a contact with only a name — every other field is optional', () => {
        expect(validateContactForm({ ...emptyContactForm(), name: 'Rafiq Islam' }, MESSAGES)).toEqual({});
    });

    it('rejects a malformed email', () => {
        const form = { ...emptyContactForm(), name: 'Rafiq', email: 'rafiq@' };
        expect(validateContactForm(form, MESSAGES)).toEqual({ email: MESSAGES.invalidEmail });
    });
});

describe('applyScannedCard', () => {
    it('fills empty fields from the card', () => {
        const merged = applyScannedCard(emptyContactForm(), {
            name: 'Rafiq Islam',
            company: 'Karim Traders',
            mobile: '01711223344',
        });

        expect(merged).toMatchObject({
            name: 'Rafiq Islam',
            company: 'Karim Traders',
            mobile: '01711223344',
        });
    });

    // The scan is a suggestion, not a source of truth: what the user typed by
    // hand outranks anything the model read off a photograph.
    it('never overwrites a value the user already typed', () => {
        const form = { ...emptyContactForm(), name: 'Rafiqul Islam', company: '' };

        const merged = applyScannedCard(form, { name: 'Rafiq Islam', company: 'Karim Traders' });

        expect(merged.name).toBe('Rafiqul Islam');
        expect(merged.company).toBe('Karim Traders');
    });

    it('ignores blanks and keys the form has no field for', () => {
        const merged = applyScannedCard(emptyContactForm(), {
            name: 'Rafiq Islam',
            company: '   ',
            raw_text: 'Karim Traders\nDhaka',
        } as Record<string, string>);

        expect(merged.company).toBe('');
        expect(merged).toEqual({ ...emptyContactForm(), name: 'Rafiq Islam' });
    });

    it('trims what it takes from the card', () => {
        expect(applyScannedCard(emptyContactForm(), { mobile: '  01711223344 ' }).mobile).toBe(
            '01711223344',
        );
    });
});

describe('contactFormToPayload', () => {
    // Omitting a cleared field would read as "leave it alone" on a PATCH, so a
    // designation the scanner got wrong could never be removed.
    it('sends cleared fields as empty strings so they can be erased', () => {
        const form = { ...emptyContactForm(), name: 'Rafiq Islam', designation: '' };

        expect(contactFormToPayload(form)).toMatchObject({ name: 'Rafiq Islam', designation: '' });
    });

    it('trims every value it sends', () => {
        const form = { ...emptyContactForm(), name: '  Rafiq Islam  ', email: ' rafiq@example.com ' };

        expect(contactFormToPayload(form)).toMatchObject({
            name: 'Rafiq Islam',
            email: 'rafiq@example.com',
        });
    });
});

describe('contactToFormState', () => {
    it('turns the API nulls into the empty strings the inputs need', () => {
        const state = contactToFormState({
            name: 'Rafiq Islam',
            company: null,
            mobile: '01711223344',
            assigned_to: null,
        });

        expect(state).toEqual({
            ...emptyContactForm(),
            name: 'Rafiq Islam',
            mobile: '01711223344',
        });
    });
});

describe('photo fields', () => {
    it('starts empty', () => {
        const form = emptyContactForm();
        expect(form.photo_url).toBe('');
        expect(form.photo_storage_key).toBe('');
    });

    it('reads both fields off a saved contact', () => {
        const form = contactToFormState({
            name: 'Rahim',
            photo_url: 'https://cdn.example/rahim.jpg',
            photo_storage_key: 'retail/tenant-1/crm-photos/rahim',
        });
        expect(form.photo_url).toBe('https://cdn.example/rahim.jpg');
        expect(form.photo_storage_key).toBe('retail/tenant-1/crm-photos/rahim');
    });

    it('treats a contact with no photo as empty strings, not "null"', () => {
        const form = contactToFormState({ name: 'Rahim', photo_url: null });
        expect(form.photo_url).toBe('');
        expect(form.photo_storage_key).toBe('');
    });

    it('sends both fields in the payload', () => {
        const payload = contactFormToPayload({
            ...emptyContactForm(),
            name: 'Rahim',
            photo_url: 'https://cdn.example/rahim.jpg',
            photo_storage_key: 'retail/tenant-1/crm-photos/rahim',
        });
        expect(payload.photo_url).toBe('https://cdn.example/rahim.jpg');
        expect(payload.photo_storage_key).toBe('retail/tenant-1/crm-photos/rahim');
    });

    it('sends blanks when the photo was removed, so the backend clears it', () => {
        const payload = contactFormToPayload({ ...emptyContactForm(), name: 'Rahim' });
        expect(payload.photo_url).toBe('');
        expect(payload.photo_storage_key).toBe('');
    });

    it('does not let a scanned card overwrite the photo fields', () => {
        const merged = applyScannedCard(emptyContactForm(), {
            name: 'Rahim',
            photo_url: 'https://evil.example/x.jpg',
        } as any);
        expect(merged.photo_url).toBe('');
    });
});
