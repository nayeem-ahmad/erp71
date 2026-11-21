import { act, fireEvent, render, screen, within } from '@testing-library/react';
import PageTimingStrip from './PageTimingStrip';
import { pageTiming, type PageView } from '@/lib/page-timing/collector';
import {
    resetPageTimingViewerForTests,
    setPageTimingSwitchedOn,
    setPageTimingViewerIsStaff,
} from '@/lib/page-timing/viewer';

let mockPathname = '/sales/42';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
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

const showToStaff = () =>
    act(() => {
        setPageTimingViewerIsStaff(true);
        setPageTimingSwitchedOn(true);
    });

describe('PageTimingStrip', () => {
    beforeEach(() => {
        mockPathname = '/sales/42';
        jest.spyOn(pageTiming, 'getSnapshot').mockReturnValue({ current: null, history: [view] });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        resetPageTimingViewerForTests();
        window.localStorage.clear();
    });

    it('shows nothing to a tenant user, even with the switch on', () => {
        act(() => setPageTimingSwitchedOn(true));
        const { container } = render(<PageTimingStrip />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows nothing to platform staff who have not switched it on', () => {
        act(() => setPageTimingViewerIsStaff(true));
        const { container } = render(<PageTimingStrip />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows the total and each phase of the page on screen', () => {
        showToStaff();
        render(<PageTimingStrip />);

        const strip = screen.getByRole('region', { name: 'Page timing' });
        expect(within(strip).getByText('1.65 s')).toHaveClass('text-amber-700');
        expect(within(strip).getByText('Full page load')).toBeInTheDocument();
        expect(
            within(strip).getByRole('list', { name: 'Document 200 ms, App start 200 ms, Data 1.10 s, Render 150 ms' }),
        ).toBeInTheDocument();
        // The page on screen is the one measured, so its path is not repeated.
        expect(within(strip).queryByText('/sales/42')).not.toBeInTheDocument();
    });

    it('names the page when the last measured view is not the one on screen', () => {
        mockPathname = '/customers';
        showToStaff();
        render(<PageTimingStrip />);
        expect(screen.getByTitle('/sales/42')).toBeInTheDocument();
    });

    it('opens the full breakdown', () => {
        showToStaff();
        render(<PageTimingStrip />);

        fireEvent.click(screen.getByRole('button', { name: 'Page timing details' }));

        expect(screen.getByText(/DNS 10 ms · Connect 45 ms · Server response 120 ms · Download 25 ms/)).toBeInTheDocument();
        expect(screen.getByText('auth 6 ms (1 query) · Database 900 ms (9 queries) · app 31 ms')).toBeInTheDocument();
    });

    it('says it is measuring while the next view is under way', () => {
        jest.spyOn(pageTiming, 'getSnapshot').mockReturnValue({
            current: { ...view, id: 2, endedAt: null, phases: null },
            history: [],
        });
        showToStaff();
        render(<PageTimingStrip />);
        expect(screen.getByRole('region', { name: 'Page timing' })).toHaveTextContent('Measuring…');
        expect(screen.queryByRole('button', { name: 'Page timing details' })).not.toBeInTheDocument();
    });
});
