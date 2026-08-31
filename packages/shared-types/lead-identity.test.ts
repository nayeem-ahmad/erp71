import {
    identityDedupeKeys,
    identityMatchArms,
    labelForDedupeKey,
    leadIdentityOf,
    leadIdentityPatch,
    normalizeLeadEmail,
    normalizeLeadMobile,
    normalizeProfileUrl,
} from './lead-identity';

describe('normalizeLeadMobile', () => {
    it('collapses every spelling of one BD number onto a single string', () => {
        const canonical = '+8801712345678';
        for (const spelling of [
            '01712345678',
            '01712-345678',
            '+880 1712 345678',
            '8801712345678',
            ' 01712 345 678 ',
        ]) {
            expect(normalizeLeadMobile(spelling)).toBe(canonical);
        }
    });

    it('falls back to digits for a number E.164 normalization rejects', () => {
        // A foreign number in a format the shared helper does not model still has
        // to compare equal to itself, or both spellings would import.
        expect(normalizeLeadMobile('+91 98765 43210')).toBe('919876543210');
        expect(normalizeLeadMobile('919876543210')).toBe('919876543210');
    });

    it('maps blank and missing to null rather than an empty string', () => {
        expect(normalizeLeadMobile('')).toBeNull();
        expect(normalizeLeadMobile('   ')).toBeNull();
        expect(normalizeLeadMobile(null)).toBeNull();
        expect(normalizeLeadMobile(undefined)).toBeNull();
        expect(normalizeLeadMobile('n/a')).toBeNull();
    });
});

describe('normalizeLeadEmail', () => {
    it('lowercases and trims', () => {
        expect(normalizeLeadEmail('  A@Shop.COM ')).toBe('a@shop.com');
    });

    it('leaves dots and plus tags alone', () => {
        // Merging these would fuse addresses their owner uses to stay separate.
        expect(normalizeLeadEmail('j.doe+crm@gmail.com')).toBe('j.doe+crm@gmail.com');
    });

    it('maps blank to null', () => {
        expect(normalizeLeadEmail('  ')).toBeNull();
        expect(normalizeLeadEmail(null)).toBeNull();
    });
});

describe('normalizeProfileUrl', () => {
    it('collapses scheme, www, case, query and trailing slash', () => {
        const canonical = 'linkedin.com/in/jane-doe';
        for (const spelling of [
            'https://www.LinkedIn.com/in/Jane-Doe/',
            'http://linkedin.com/in/jane-doe',
            'linkedin.com/in/jane-doe',
            'https://www.linkedin.com/in/jane-doe/?utm_source=newsletter',
            'https://linkedin.com/in/jane-doe#about',
        ]) {
            expect(normalizeProfileUrl(spelling)).toBe(canonical);
        }
    });

    it('maps blank to null', () => {
        expect(normalizeProfileUrl('')).toBeNull();
        expect(normalizeProfileUrl('https://')).toBeNull();
    });
});

describe('leadIdentityOf', () => {
    it('normalizes all three keys at once', () => {
        expect(
            leadIdentityOf({
                mobile: '01712-345678',
                email: 'A@Shop.com',
                linkedin_url: 'https://www.linkedin.com/in/Jane/',
            }),
        ).toEqual({
            mobile_norm: '+8801712345678',
            email_norm: 'a@shop.com',
            linkedin_norm: 'linkedin.com/in/jane',
        });
    });

    it('nulls the keys a lead does not carry', () => {
        expect(leadIdentityOf({ email: 'a@b.com' })).toEqual({
            mobile_norm: null,
            email_norm: 'a@b.com',
            linkedin_norm: null,
        });
    });
});

describe('leadIdentityPatch', () => {
    it('omits untouched fields so an edit cannot clear an identity it never named', () => {
        expect(leadIdentityPatch({ email: 'A@B.com' })).toEqual({ email_norm: 'a@b.com' });
    });

    it('clears a field explicitly blanked', () => {
        expect(leadIdentityPatch({ mobile: '' })).toEqual({ mobile_norm: null });
    });

    it('is empty for a patch touching no identity field', () => {
        expect(leadIdentityPatch({})).toEqual({});
    });
});

describe('identityMatchArms', () => {
    it('builds one arm per populated key', () => {
        expect(
            identityMatchArms({ mobile_norm: '+8801712345678', email_norm: null, linkedin_norm: 'x' }),
        ).toEqual([{ mobile_norm: '+8801712345678' }, { linkedin_norm: 'x' }]);
    });

    it('is empty for a lead with no identity at all', () => {
        expect(identityMatchArms({ mobile_norm: null, email_norm: null, linkedin_norm: null })).toEqual([]);
    });
});

describe('identityDedupeKeys', () => {
    it('namespaces by column so unlike fields cannot collide', () => {
        expect(identityDedupeKeys({ mobile_norm: '123', email_norm: '123' })).toEqual([
            'mobile_norm:123',
            'email_norm:123',
        ]);
    });

    it('names the field a key came from', () => {
        expect(labelForDedupeKey('email_norm:a@b.com')).toBe('email');
        expect(labelForDedupeKey('mobile_norm:+8801712345678')).toBe('mobile number');
    });
});
