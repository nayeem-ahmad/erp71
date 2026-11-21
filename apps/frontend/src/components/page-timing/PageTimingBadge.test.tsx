import { act, fireEvent, render, screen, within } from '@testing-library/react';
import PageTimingBadge from './PageTimingBadge';
import { pageTiming, type PageTimingSnapshot, type PageView } from '@/lib/page-timing/collector';
import {
    resetPageTimingViewerForTests,
    setPageTimingSwitchedOn,
    setPageTimingViewerIsStaff,
} from '@/lib/page-timing/viewer';

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href, onClick, className }: any) => (
        <a href={href} onClick={onClick} className={className}>{children}</a>
    ),
}));

const view: PageView = {
    id: 1,
    navType: 'load',
    path: '/sales/42',
    route: '/sales/:id',
    startedAt: 0,
    committedAt: 450,
    endedAt: 1650,
    document: { dnsMs: 10, connectMs: 45, waitMs: 120, downloadMs: 25, totalMs: 200 },
    calls: [
        {
            id: 1,
            method: 'GET',
            path: '/sales/42',
            label: 'GET /sales/:id',
            startedAt: 400,
            sentAt: 400,
            headersAt: 1450,
            endedAt: 1500,
            status: 200,
            server: { authMs: 6, dbMs: 900, appMs: 31, totalMs: 937, authQueries: 1, dbQueries: 9 },
        },
    ],
    phases: {
        totalMs: 1650,
        documentMs: 200,
        bootMs: 200,
        dataMs: 1100,
        renderMs: 150,
        apiCalls: 1,
        networkMs: 163,
        serverMs: 937,
        dbMs: 900,
        tokenWaitMs: 0,
        slowest: { label: 'GET /sales/:id', ms: 1100 },
    },
    reported: true,
    wasHidden: false,
    timedOut: false,
};

const snapshot: PageTimingSnapshot = { current: null, history: [view] };

describe('PageTimingBadge', () => {
    beforeEach(() => {
        jest.spyOn(pageTiming, 'getSnapshot').mockReturnValue(snapshot);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        resetPageTimingViewerForTests();
        window.localStorage.clear();
    });

    it('shows nothing to a tenant user, even with the switch on', () => {
        act(() => setPageTimingSwitchedOn(true));
        const { container } = render(<PageTimingBadge />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows nothing to platform staff who have not switched it on', () => {
        act(() => setPageTimingViewerIsStaff(true));
        const { container } = render(<PageTimingBadge />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows the load time, and the breakdown when opened', () => {
        act(() => {
            setPageTimingViewerIsStaff(true);
            setPageTimingSwitchedOn(true);
        });
        render(<PageTimingBadge />);

        const badge = screen.getByRole('button', { name: 'Page timing details' });
        expect(badge).toHaveTextContent('1.65 s');
        expect(badge.querySelector('.text-amber-700')).not.toBeNull();

        fireEvent.click(badge);

        const dialog = screen.getByText('Page timing').closest('div')!.parentElement!.parentElement!;
        expect(within(dialog).getByText('Full page load')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Document 200 ms, App start 200 ms, Data 1.10 s, Render 150 ms' })).toBeInTheDocument();
        expect(screen.getByText(/DNS 10 ms · Connect 45 ms · Server response 120 ms · Download 25 ms/)).toBeInTheDocument();
        expect(screen.getByText('Network 163 ms · Server 937 ms')).toBeInTheDocument();
        expect(screen.getByText('auth 6 ms (1 query) · Database 900 ms (9 queries) · app 31 ms')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Open the page performance dashboard' })).toHaveAttribute('href', '/admin/system-health');
    });

    it('says it is measuring while a view is under way', () => {
        jest.spyOn(pageTiming, 'getSnapshot').mockReturnValue({ current: { ...view, endedAt: null, phases: null }, history: [] });
        act(() => {
            setPageTimingViewerIsStaff(true);
            setPageTimingSwitchedOn(true);
        });
        render(<PageTimingBadge />);
        expect(screen.getByRole('button', { name: 'Page timing details' })).toHaveTextContent('Measuring…');
    });
});
