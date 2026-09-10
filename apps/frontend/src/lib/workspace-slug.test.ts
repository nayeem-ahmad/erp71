import {
    normalizeWorkspaceSlug,
    parseWorkspaceEntryPath,
    preferredWorkspaceSlug,
    resolveWorkspaceSlug,
    slugifyWorkspaceName,
    workspaceEntryPath,
} from './workspace-slug';

const KARIM = { id: '11111111-1111-1111-1111-111111111111', name: 'Karim Electronics', storefront_slug: 'karim' };
const RAHIM = { id: '22222222-2222-2222-2222-222222222222', name: 'Rahim Pharmacy', storefront_slug: null };

describe('slugifyWorkspaceName', () => {
    it('lowercases and hyphenates', () => {
        expect(slugifyWorkspaceName('Karim Electronics')).toBe('karim-electronics');
    });

    it('folds accents rather than dropping the letter', () => {
        expect(slugifyWorkspaceName('Café Dhaka')).toBe('cafe-dhaka');
    });

    it('drops apostrophes instead of turning them into separators', () => {
        expect(slugifyWorkspaceName("Karim's Shop")).toBe('karims-shop');
    });

    it('collapses runs of punctuation and trims the edges', () => {
        expect(slugifyWorkspaceName('  --Karim &  Sons!!  ')).toBe('karim-sons');
    });

    it('returns nothing for a name with no ASCII, so the shop is reached another way', () => {
        expect(slugifyWorkspaceName('করিম ইলেকট্রনিক্স')).toBe('');
    });

    it('handles null and undefined', () => {
        expect(slugifyWorkspaceName(null)).toBe('');
        expect(slugifyWorkspaceName(undefined)).toBe('');
    });

    it('truncates on a hyphen so a long name never ends mid-word', () => {
        const slug = slugifyWorkspaceName(`${'a'.repeat(30)} ${'b'.repeat(30)} ${'c'.repeat(40)}`);
        expect(slug).toBe(`${'a'.repeat(30)}-${'b'.repeat(30)}`);
    });
});

describe('normalizeWorkspaceSlug', () => {
    it('folds a hand-typed name onto the same slug the link uses', () => {
        expect(normalizeWorkspaceSlug('Karim Electronics')).toBe('karim-electronics');
        expect(normalizeWorkspaceSlug('KARIM')).toBe('karim');
    });

    it('leaves a uuid alone', () => {
        expect(normalizeWorkspaceSlug(KARIM.id)).toBe(KARIM.id);
    });
});

describe('resolveWorkspaceSlug', () => {
    const tenants = [KARIM, RAHIM];

    it('matches on the tenant id', () => {
        expect(resolveWorkspaceSlug(tenants, KARIM.id)).toEqual({ status: 'matched', tenant: KARIM });
    });

    it('matches on the storefront slug', () => {
        expect(resolveWorkspaceSlug(tenants, 'karim')).toEqual({ status: 'matched', tenant: KARIM });
    });

    it('matches on the slugified name', () => {
        expect(resolveWorkspaceSlug(tenants, 'rahim-pharmacy')).toEqual({ status: 'matched', tenant: RAHIM });
    });

    it('matches a name typed the way a person would write it', () => {
        expect(resolveWorkspaceSlug(tenants, 'Rahim Pharmacy')).toEqual({ status: 'matched', tenant: RAHIM });
    });

    it('reports a slug none of the user’s workspaces answer to', () => {
        expect(resolveWorkspaceSlug(tenants, 'someone-elses-shop')).toEqual({ status: 'not-found' });
    });

    it('reports nothing for an empty or missing slug', () => {
        expect(resolveWorkspaceSlug(tenants, '')).toEqual({ status: 'not-found' });
        expect(resolveWorkspaceSlug(tenants, null)).toEqual({ status: 'not-found' });
        expect(resolveWorkspaceSlug(tenants, 'করিম')).toEqual({ status: 'not-found' });
    });

    it('reports nothing when the user has no workspaces', () => {
        expect(resolveWorkspaceSlug([], 'karim')).toEqual({ status: 'not-found' });
        expect(resolveWorkspaceSlug(null, 'karim')).toEqual({ status: 'not-found' });
    });

    it('calls two shops sharing a name ambiguous rather than picking one', () => {
        const twins = [
            { id: 'a', name: 'Karim Store', storefront_slug: null },
            { id: 'b', name: 'Karim Store', storefront_slug: null },
        ];
        expect(resolveWorkspaceSlug(twins, 'karim-store')).toEqual({ status: 'ambiguous', tenants: twins });
    });

    it('lets a storefront slug settle what a shared name could not', () => {
        // Both are "Karim Store", so tier 3 is ambiguous — but tier 2 matched
        // exactly one first, and a weaker tier never overrides a stronger one.
        const twins = [
            { id: 'a', name: 'Karim Store', storefront_slug: 'karim-store' },
            { id: 'b', name: 'Karim Store', storefront_slug: 'karim-store-2' },
        ];
        expect(resolveWorkspaceSlug(twins, 'karim-store')).toEqual({ status: 'matched', tenant: twins[0] });
    });

    it('ignores a workspace whose identifier is empty rather than matching an empty slug', () => {
        const blank = [{ id: 'a', name: null, storefront_slug: null }];
        expect(resolveWorkspaceSlug(blank, '')).toEqual({ status: 'not-found' });
    });
});

describe('preferredWorkspaceSlug', () => {
    it('prefers the storefront slug, which is unique platform-wide', () => {
        expect(preferredWorkspaceSlug(KARIM)).toBe('karim');
    });

    it('falls back to the slugified name', () => {
        expect(preferredWorkspaceSlug(RAHIM)).toBe('rahim-pharmacy');
    });

    it('falls back to the id when a name slugifies to nothing', () => {
        const bangla = { id: 'tenant-9', name: 'করিম ইলেকট্রনিক্স', storefront_slug: null };
        expect(preferredWorkspaceSlug(bangla)).toBe('tenant-9');
    });

    it('builds a link, optionally deep into the app', () => {
        expect(workspaceEntryPath(KARIM)).toBe('/w/karim');
        expect(workspaceEntryPath(KARIM, '/sales/pos')).toBe('/w/karim/sales/pos');
        expect(workspaceEntryPath(KARIM, 'sales/pos')).toBe('/w/karim/sales/pos');
        expect(workspaceEntryPath(KARIM, '/')).toBe('/w/karim');
    });
});

describe('parseWorkspaceEntryPath', () => {
    it('reads the workspace and defaults to the app home', () => {
        expect(parseWorkspaceEntryPath('/w/karim')).toEqual({ slug: 'karim', redirect: '/dashboard' });
    });

    it('carries the rest of the path through as the destination', () => {
        expect(parseWorkspaceEntryPath('/w/karim/sales/pos')).toEqual({ slug: 'karim', redirect: '/sales/pos' });
    });

    it('tolerates a trailing slash', () => {
        expect(parseWorkspaceEntryPath('/w/karim/')).toEqual({ slug: 'karim', redirect: '/dashboard' });
    });

    it('decodes and folds a hand-typed workspace segment', () => {
        expect(parseWorkspaceEntryPath('/w/Karim%20Electronics').slug).toBe('karim-electronics');
    });

    it('reports no workspace for `/w` on its own', () => {
        expect(parseWorkspaceEntryPath('/w')).toEqual({ slug: '', redirect: '/dashboard' });
        expect(parseWorkspaceEntryPath('/w/')).toEqual({ slug: '', redirect: '/dashboard' });
    });

    it('reports no workspace for a path that is not an entry URL', () => {
        expect(parseWorkspaceEntryPath('/dashboard')).toEqual({ slug: '', redirect: '/dashboard' });
        expect(parseWorkspaceEntryPath(null)).toEqual({ slug: '', redirect: '/dashboard' });
    });

    it('honours a caller-supplied home', () => {
        expect(parseWorkspaceEntryPath('/w/karim', '/my')).toEqual({ slug: 'karim', redirect: '/my' });
    });

    it('refuses a destination that would leave the origin', () => {
        // An encoded slash would decode into a real one and make the tail read
        // as `//evil.example` — a protocol-relative URL.
        expect(parseWorkspaceEntryPath('/w/karim/%2F%2Fevil.example').redirect).toBe('/%2F%2Fevil.example');
        expect(parseWorkspaceEntryPath('/w/karim//evil.example').redirect).toBe('/evil.example');
    });

    it('ignores a query string and hash, which the caller re-attaches', () => {
        expect(parseWorkspaceEntryPath('/w/karim/sales?status=DUE#top')).toEqual({
            slug: 'karim',
            redirect: '/sales',
        });
    });
});
