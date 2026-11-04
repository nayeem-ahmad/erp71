import {
    buildSearchQuery,
    clampCandidateLimit,
    DEFAULT_LOCATION,
    DEFAULT_NICHE,
    markDuplicates,
    normalizeWebsite,
    parseCandidates,
    type LeadGenerationBrief,
} from './lead-generation.util';

describe('clampCandidateLimit', () => {
    it('defaults to 8 when the caller sends nothing', () => {
        expect(clampCandidateLimit(undefined)).toBe(8);
    });

    it('caps at 15 so one search cannot dump a whole directory into the review list', () => {
        expect(clampCandidateLimit(100)).toBe(15);
    });

    it('floors at 1', () => {
        expect(clampCandidateLimit(0)).toBe(1);
        expect(clampCandidateLimit(-4)).toBe(1);
    });
});

describe('buildSearchQuery', () => {
    const brief = (over: Partial<LeadGenerationBrief> = {}): LeadGenerationBrief => ({
        niche: DEFAULT_NICHE,
        location: DEFAULT_LOCATION,
        companySize: '',
        keywords: '',
        limit: 8,
        ...over,
    });

    it('still names B2B companies when the niche is blank', () => {
        const query = buildSearchQuery(brief({ niche: '' }));
        expect(query.toLowerCase()).toContain('b2b');
        expect(query.toLowerCase()).toContain('compan');
        expect(query.toLowerCase()).toContain('small and medium');
    });

    it('keeps a restaurant-shaped niche as restaurants, not software companies that serve them', () => {
        const query = buildSearchQuery(brief({ niche: 'restaurants in Gulshan' }));
        expect(query.toLowerCase()).toContain('restaurants in gulshan');
        expect(query.toLowerCase()).not.toContain('software');
    });

    it('includes location, size, keywords and the requested count', () => {
        const query = buildSearchQuery(
            brief({
                niche: 'retailers and wholesalers',
                location: 'Dhaka',
                companySize: '20-50 people',
                keywords: 'grocery export',
                limit: 6,
            }),
        );
        expect(query).toContain('retailers and wholesalers');
        expect(query).toContain('Dhaka');
        expect(query).toContain('20-50 people');
        expect(query).toContain('grocery export');
        expect(query).toContain('6');
    });
});

describe('normalizeWebsite', () => {
    it('collapses protocol, www and a trailing slash so the same company matches', () => {
        expect(normalizeWebsite('https://www.AcmeSoft.com/')).toBe('acmesoft.com');
        expect(normalizeWebsite('http://acmesoft.com')).toBe('acmesoft.com');
    });

    it('returns null for blank or unusable values', () => {
        expect(normalizeWebsite('')).toBeNull();
        expect(normalizeWebsite('   ')).toBeNull();
        expect(normalizeWebsite(null)).toBeNull();
    });
});

describe('parseCandidates', () => {
    it('keeps named companies and drops rows with no company name', () => {
        const parsed = parseCandidates(
            {
                candidates: [
                    { company_name: 'Acme Soft', website_url: 'https://acmesoft.com', fit_score: 82 },
                    { company_name: '  ', website_url: 'https://empty.com' },
                    { website_url: 'https://no-name.com' },
                ],
            },
            8,
        );
        expect(parsed).toHaveLength(1);
        expect(parsed[0].company_name).toBe('Acme Soft');
        expect(parsed[0].fit_score).toBe(82);
    });

    it('accepts a bare array as well as a { candidates } envelope', () => {
        const parsed = parseCandidates([{ company_name: 'Nexlify' }], 8);
        expect(parsed.map((c) => c.company_name)).toEqual(['Nexlify']);
    });

    it('clamps fit_score to 0–100 and leaves invented blanks as null', () => {
        const [row] = parseCandidates(
            [{ company_name: 'Acme', fit_score: 140, email: '  ', linkedin_url: '' }],
            8,
        );
        expect(row.fit_score).toBe(100);
        expect(row.email).toBeNull();
        expect(row.linkedin_url).toBeNull();
    });

    it('caps the list at the requested limit', () => {
        const payload = {
            candidates: [
                { company_name: 'One' },
                { company_name: 'Two' },
                { company_name: 'Three' },
            ],
        };
        expect(parseCandidates(payload, 2)).toHaveLength(2);
    });
});

describe('markDuplicates', () => {
    it('flags a candidate whose website already belongs to a lead', () => {
        const [row] = markDuplicates(
            [
                {
                    company_name: 'Acme Soft',
                    website_url: 'https://www.acmesoft.com',
                    linkedin_url: null,
                    email: null,
                    location: null,
                    description: null,
                    fit_score: 80,
                    fit_reason: null,
                    source_url: null,
                    unverified: false,
                },
            ],
            [{ id: 'lead-1', name: 'Acme Software Ltd', website_url: 'http://acmesoft.com/' }],
        );
        expect(row.existing_lead_id).toBe('lead-1');
        expect(row.existing_lead_name).toBe('Acme Software Ltd');
    });

    it('flags a candidate whose company name matches an existing lead when websites are missing', () => {
        const [row] = markDuplicates(
            [
                {
                    company_name: 'Karim Traders',
                    website_url: null,
                    linkedin_url: null,
                    email: null,
                    location: null,
                    description: null,
                    fit_score: 50,
                    fit_reason: null,
                    source_url: null,
                    unverified: false,
                },
            ],
            [{ id: 'lead-2', name: '  Karim   Traders  ', website_url: null }],
        );
        expect(row.existing_lead_id).toBe('lead-2');
    });

    it('leaves a new company unmarked', () => {
        const [row] = markDuplicates(
            [
                {
                    company_name: 'Brand New Soft',
                    website_url: 'https://brandnew.soft',
                    linkedin_url: null,
                    email: null,
                    location: null,
                    description: null,
                    fit_score: 70,
                    fit_reason: null,
                    source_url: null,
                    unverified: false,
                },
            ],
            [{ id: 'lead-1', name: 'Acme Soft', website_url: 'https://acmesoft.com' }],
        );
        expect(row.existing_lead_id).toBeNull();
    });
});
