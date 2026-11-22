import { Banknote, LayoutDashboard, Package, ShoppingCart, Video } from 'lucide-react';
import type { ResolvedNavModule } from '@/lib/nav-resolver';
import {
    RECENT_NAV_KEEP,
    currentNavHref,
    flattenNavLinks,
    pushRecentHref,
    readRecentHrefs,
    readRecentOpen,
    resolveRecentNav,
    writeRecentHrefs,
    writeRecentOpen,
} from './recent-nav';

const MODULES: ResolvedNavModule[] = [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
    {
        key: 'sales',
        label: 'Sales',
        icon: ShoppingCart,
        children: [
            { href: '/sales/pos', label: 'POS', icon: ShoppingCart },
            { href: '/sales/section', label: 'Documents', icon: ShoppingCart, section: true },
            { href: '/sales/list', label: 'Invoices', icon: ShoppingCart },
            {
                type: 'subgroup',
                key: 'payments',
                label: 'Payments',
                icon: Banknote,
                children: [{ href: '/sales/customer-payments', label: 'Customer payments', icon: Banknote }],
            },
        ],
    },
    {
        key: 'inventory',
        label: 'Inventory',
        icon: Package,
        children: [
            { href: '/inventory', label: 'Products', icon: Package, exact: true },
            { href: '/inventory/reports/reorder', label: 'Reorder', icon: Package },
        ],
    },
    { key: 'meet', label: 'Meet', icon: Video, children: [{ href: 'https://meet.example.com', label: 'Meet71', icon: Video }] },
    { key: 'soon', label: 'Soon', icon: Video, soon: true, href: '/soon' },
];

describe('flattenNavLinks', () => {
    it('lists every real link with its module, skipping section headings, external links and "soon" modules', () => {
        expect(flattenNavLinks(MODULES).map((link) => `${link.moduleLabel}/${link.href}`)).toEqual([
            'Dashboard//dashboard',
            'Sales//sales/pos',
            'Sales//sales/list',
            'Sales//sales/customer-payments',
            'Inventory//inventory',
            'Inventory//inventory/reports/reorder',
        ]);
    });
});

describe('currentNavHref', () => {
    it('is the menu item the nav lights for the page, including pages under it', () => {
        expect(currentNavHref(MODULES, '/sales/list')).toBe('/sales/list');
        expect(currentNavHref(MODULES, '/sales/list/inv-42')).toBe('/sales/list');
        expect(currentNavHref(MODULES, '/inventory/reports/reorder')).toBe('/inventory/reports/reorder');
    });

    it('respects an exact link', () => {
        expect(currentNavHref(MODULES, '/inventory')).toBe('/inventory');
        expect(currentNavHref(MODULES, '/inventory/abc')).toBeNull();
    });

    it('is null for a page no menu item covers', () => {
        expect(currentNavHref(MODULES, '/notifications')).toBeNull();
    });
});

describe('pushRecentHref', () => {
    it('puts the newest first and drops the older copy', () => {
        expect(pushRecentHref(['/a', '/b', '/c'], '/c')).toEqual(['/c', '/a', '/b']);
    });

    it('returns the same list when the page is already first, so nothing re-renders', () => {
        const list = ['/a', '/b'];
        expect(pushRecentHref(list, '/a')).toBe(list);
    });

    it('keeps at most RECENT_NAV_KEEP', () => {
        const list = Array.from({ length: RECENT_NAV_KEEP }, (_, i) => `/p${i}`);
        const next = pushRecentHref(list, '/new');
        expect(next).toHaveLength(RECENT_NAV_KEEP);
        expect(next[0]).toBe('/new');
        expect(next).not.toContain(`/p${RECENT_NAV_KEEP - 1}`);
    });
});

describe('resolveRecentNav', () => {
    it('leaves out the page you are on and anything the nav no longer has', () => {
        const items = resolveRecentNav(['/sales/list', '/gone', '/sales/pos', '/dashboard'], MODULES, '/sales/list');
        expect(items.map((item) => item.label)).toEqual(['POS', 'Dashboard']);
        expect(items[0].moduleLabel).toBe('Sales');
    });

    it('shows at most `show`', () => {
        const hrefs = flattenNavLinks(MODULES).map((link) => link.href);
        expect(resolveRecentNav(hrefs, MODULES, null, 3)).toHaveLength(3);
    });
});

describe('storage', () => {
    beforeEach(() => localStorage.clear());

    it('keeps each member-and-workspace list apart', () => {
        writeRecentHrefs('t1:u1', ['/sales/pos']);
        writeRecentHrefs('t1:u2', ['/inventory']);
        expect(readRecentHrefs('t1:u1')).toEqual(['/sales/pos']);
        expect(readRecentHrefs('t1:u2')).toEqual(['/inventory']);
        expect(readRecentHrefs('t2:u1')).toEqual([]);
    });

    it('stores nothing and reads nothing without a scope', () => {
        writeRecentHrefs(null, ['/sales/pos']);
        expect(localStorage.length).toBe(0);
        expect(readRecentHrefs(null)).toEqual([]);
    });

    it('ignores a corrupted entry', () => {
        localStorage.setItem('erp71:nav-recent:t1:u1', '{not json');
        expect(readRecentHrefs('t1:u1')).toEqual([]);
        localStorage.setItem('erp71:nav-recent:t1:u1', JSON.stringify(['/a', 5, null, '/b']));
        expect(readRecentHrefs('t1:u1')).toEqual(['/a', '/b']);
    });

    it('remembers the fold, open by default', () => {
        expect(readRecentOpen()).toBe(true);
        writeRecentOpen(false);
        expect(readRecentOpen()).toBe(false);
    });
});
