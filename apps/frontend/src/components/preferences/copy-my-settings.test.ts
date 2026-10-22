import {
    DEFAULT_ALERT_PREFS,
    DEFAULT_INVOICE_PRINT_PREFS,
    DEFAULT_TABLE_VIEW,
    resolvePreferences,
    type LegacyBrowserSection,
    type MyPreferencesResponse,
    type PreferenceProfilePrefs,
    type SectionPartials,
} from '@erp71/shared-types';
import { api } from '@/lib/api';
import { usePreferencesStore } from '@/lib/preferences/store';
import { collectMySettings } from './copy-my-settings';

jest.mock('@/lib/api', () => ({ api: { getMyPreferences: jest.fn() } }));

const mockApi = api as jest.Mocked<typeof api>;

function response({
    member,
    profile,
    legacy = [],
}: {
    member?: SectionPartials;
    profile?: SectionPartials;
    legacy?: LegacyBrowserSection[];
} = {}): MyPreferencesResponse {
    const profilePrefs: PreferenceProfilePrefs | null = profile ? { version: 1, sections: profile } : null;
    return {
        profile: profile ? { id: 'p1', name: 'Cashier' } : null,
        legacy_browser_sections: legacy,
        sections: resolvePreferences({ member, profile: profilePrefs }),
    };
}

function hydrate(data: MyPreferencesResponse) {
    usePreferencesStore.setState({ ready: true, scopeKey: 't1:u1', data });
}

beforeEach(() => {
    window.localStorage.clear();
    usePreferencesStore.setState({ ready: false, scopeKey: null, data: null });
    jest.clearAllMocks();
});

describe('collectMySettings — person sections', () => {
    it('returns what the member sees, legacy browser values included', async () => {
        // Nothing of their own on the server for lists, but this browser still
        // holds the look and the columns they set up before the move.
        window.localStorage.setItem('erp71:table-view:anon', JSON.stringify({ global: { density: 'compact' } }));
        window.localStorage.setItem(
            'data-table-preferences',
            JSON.stringify({ orders: { columnVisibility: { total: false, customer: true } } }),
        );
        hydrate(
            response({
                legacy: ['tableView', 'tableColumns'],
                member: { invoicePrint: { serial_column: true } },
            }),
        );

        const out = await collectMySettings(['tableView', 'tableColumns', 'invoicePrint']);

        expect(out).toEqual({
            tableView: { global: { ...DEFAULT_TABLE_VIEW, density: 'compact' }, tables: {} },
            tableColumns: { orders: { hidden: ['total'] } },
            invoicePrint: { ...DEFAULT_INVOICE_PRINT_PREFS, serial_column: true },
        });
    });

    it("ignores the browser's leftovers for a section the member has answered", async () => {
        window.localStorage.setItem('erp71:table-view:anon', JSON.stringify({ global: { density: 'compact' } }));
        hydrate(response({ member: { tableView: { global: { striped: false } } } }));

        const out = await collectMySettings(['tableView']);

        expect(out).toEqual({ tableView: { global: { ...DEFAULT_TABLE_VIEW, striped: false }, tables: {} } });
    });

    it("includes what the member's own profile gives them", async () => {
        hydrate(response({ profile: { alerts: { mutedTypes: ['LOW_STOCK'] } } }));

        const out = await collectMySettings(['alerts']);

        expect(out).toEqual({ alerts: { ...DEFAULT_ALERT_PREFS, mutedTypes: ['LOW_STOCK'] } });
    });

    it('returns only the sections asked for', async () => {
        hydrate(response());

        const out = await collectMySettings(['sidebar']);

        expect(Object.keys(out)).toEqual(['sidebar']);
    });

    it('loads the member preferences itself when the store has not yet', async () => {
        mockApi.getMyPreferences.mockResolvedValue(response({ member: { invoicePrint: { layout: 'detailed' } } }));

        const out = await collectMySettings(['invoicePrint']);

        expect(mockApi.getMyPreferences).toHaveBeenCalledTimes(1);
        expect(out.invoicePrint).toEqual({ ...DEFAULT_INVOICE_PRINT_PREFS, layout: 'detailed' });
    });
});

describe('collectMySettings — device', () => {
    it("holds only what this browser has stored, never the profile's starting values", async () => {
        window.localStorage.setItem('erp71:sales-print:paper-size', 'Thermal80');
        window.localStorage.setItem('erp71:print:density', 'compact');
        window.localStorage.setItem('erp71:sales-print:skip-preview', 'false');
        window.localStorage.setItem('sidebar-collapsed', 'true');
        window.localStorage.setItem('app-shell-collapsed', 'false');
        // The member's profile presets a text size and a paper; neither was chosen here.
        hydrate(response({ profile: { device: { printTypeScale: 'large', paperSize: 'A5' } } }));

        expect(await collectMySettings(['device'])).toEqual({
            device: { paperSize: 'Thermal80', printDensity: 'compact', skipPreview: false, sidebarCollapsed: true },
        });
    });

    it('reads the collapsed answer of the sidebar in use', async () => {
        window.localStorage.setItem('sidebar-collapsed', 'true');
        window.localStorage.setItem('app-shell-collapsed', 'false');
        window.localStorage.setItem('erp71:print:type-scale', 'larger');
        hydrate(response());

        expect(await collectMySettings(['device'], { appShell: true })).toEqual({
            device: { printTypeScale: 'larger', sidebarCollapsed: false },
        });
    });

    it('is empty on a browser that has chosen nothing', async () => {
        window.localStorage.setItem('erp71:sales-print:paper-size', 'Folio');
        hydrate(response({ profile: { device: { paperSize: 'A5', skipPreview: true } } }));

        expect(await collectMySettings(['device'])).toEqual({ device: {} });
    });

    it('does not need the member preferences', async () => {
        await collectMySettings(['device']);

        expect(mockApi.getMyPreferences).not.toHaveBeenCalled();
    });
});
