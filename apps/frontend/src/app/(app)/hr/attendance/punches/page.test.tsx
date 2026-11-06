'use client';

import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import AttendancePunchesPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getAttendancePunches: jest.fn(),
        getEmployees: jest.fn(),
        createAttendancePunch: jest.fn(),
        updateAttendancePunch: jest.fn(),
        deleteAttendancePunch: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/hr/attendance/punches',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const mockEmployees = [
    { id: 'emp-1', employee_code: 'EMP001', name: 'Alice Rahman' },
    { id: 'emp-2', employee_code: 'EMP002', name: 'Bob Hossain' },
];

const mockPunches = [
    {
        id: 'p-1',
        employee_id: 'emp-1',
        date: '2026-06-01',
        punched_at: '2026-06-01T09:04:00',
        direction: 'IN',
        source: 'SELF',
        notes: null,
        employee: { id: 'emp-1', name: 'Alice Rahman', employee_code: 'EMP001' },
    },
    {
        id: 'p-2',
        employee_id: 'emp-1',
        date: '2026-06-01',
        punched_at: '2026-06-01T18:12:00',
        direction: 'OUT',
        source: 'ADMIN',
        notes: 'Forgot to tap out',
        employee: { id: 'emp-1', name: 'Alice Rahman', employee_code: 'EMP001' },
    },
];

const loadApi = () => require('@/lib/api').api;

/** A toolbar chip: a button that opens its own panel. */
function chip(name: string | RegExp): HTMLElement {
    const found = screen
        .getAllByRole('button', { name })
        .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${String(name)}`);
    return found;
}

/**
 * The global setup reports every media query as unmatched, i.e. a phone, and
 * `DataTable` hides `hideOnMobile` columns there. Most of these assertions are
 * about the desktop table, so the width is chosen per test rather than left to
 * a default that silently drops two columns.
 */
const setViewport = (mdUp: boolean) => {
    (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
        matches: mdUp && query.includes('min-width'),
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
    }));
};

describe('AttendancePunchesPage', () => {
    beforeEach(() => {
        setViewport(true);
        const api = loadApi();
        api.getAttendancePunches.mockResolvedValue(mockPunches);
        api.getEmployees.mockResolvedValue(mockEmployees);
        api.createAttendancePunch.mockResolvedValue({});
        api.updateAttendancePunch.mockResolvedValue({});
        api.deleteAttendancePunch.mockResolvedValue({});
    });

    afterEach(() => jest.clearAllMocks());

    it('renders the in/out records loaded from the API', async () => {
        render(<AttendancePunchesPage />);

        await waitFor(() => {
            expect(screen.getAllByText('Alice Rahman').length).toBeGreaterThan(0);
            expect(screen.getByText('Forgot to tap out')).toBeInTheDocument();
        });
    });

    it('shows both directions as distinct labels', async () => {
        render(<AttendancePunchesPage />);

        await waitFor(() => {
            // Both a direction badge and a filter option carry each word, which
            // is fine — what matters is that IN and OUT are told apart.
            expect(screen.getAllByText('In').length).toBeGreaterThan(0);
            expect(screen.getAllByText('Out').length).toBeGreaterThan(0);
        });
    });

    it('explains that the day is rebuilt from first in and last out', async () => {
        // The rule is not discoverable from the table alone, and an admin
        // editing a punch needs to know the attendance row moves with it.
        render(<AttendancePunchesPage />);

        await waitFor(() => {
            expect(screen.getByText(/first IN becomes the clock-in/i)).toBeInTheDocument();
        });
    });

    it('names who recorded each punch', async () => {
        // "Who says you were here" is the first question of any attendance
        // dispute, so a portal tap and a typed correction must not look alike.
        render(<AttendancePunchesPage />);

        await waitFor(() => {
            expect(screen.getByText('Staff')).toBeInTheDocument();
            expect(screen.getByRole('columnheader', { name: /Recorded by/ })).toBeInTheDocument();
        });
    });

    it('drops the secondary columns on a phone', async () => {
        setViewport(false);
        render(<AttendancePunchesPage />);

        await waitFor(() => expect(screen.getAllByText('Alice Rahman').length).toBeGreaterThan(0));
        expect(screen.queryByText('Recorded by')).not.toBeInTheDocument();
        expect(screen.queryByText('Forgot to tap out')).not.toBeInTheDocument();
    });

    it('sends the punch as a local wall-clock moment', async () => {
        // A zone suffix here would shift the time against a schedule stored in
        // minutes from local midnight.
        const api = loadApi();
        render(<AttendancePunchesPage />);

        await waitFor(() => expect(screen.getByText('Add In/Out')).toBeInTheDocument());
        fireEvent.click(screen.getByText('Add In/Out'));

        const dialog = await screen.findByText('Add In/Out Record');
        expect(dialog).toBeInTheDocument();

        fireEvent.change(document.getElementById('punch-employee')!, { target: { value: 'emp-1' } });
        fireEvent.change(document.getElementById('punch-date')!, { target: { value: '2026-06-02' } });
        fireEvent.change(document.getElementById('punch-time')!, { target: { value: '09:30' } });

        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => {
            expect(api.createAttendancePunch).toHaveBeenCalledWith(
                expect.objectContaining({ punched_at: '2026-06-02T09:30:00', direction: 'IN' }),
            );
        });
    });

    it('warns before deleting rather than removing the punch on one click', async () => {
        const api = loadApi();
        render(<AttendancePunchesPage />);

        await waitFor(() => expect(screen.getAllByTitle('Delete').length).toBe(2));
        fireEvent.click(screen.getAllByTitle('Delete')[0]);

        expect(await screen.findByText('Delete in/out record')).toBeInTheDocument();
        expect(api.deleteAttendancePunch).not.toHaveBeenCalled();
    });

    it('deletes the punch once the warning is confirmed', async () => {
        const api = loadApi();
        render(<AttendancePunchesPage />);

        await waitFor(() => expect(screen.getAllByTitle('Delete').length).toBe(2));
        fireEvent.click(screen.getAllByTitle('Delete')[0]);
        await screen.findByText('Delete in/out record');

        // The confirmation button, not the row icons that opened the dialog.
        const buttons = screen.getAllByRole('button', { name: 'Delete' });
        fireEvent.click(buttons[buttons.length - 1]);

        await waitFor(() => expect(api.deleteAttendancePunch).toHaveBeenCalledWith('p-1'));
    });

    it('asks the server for one direction, from the toolbar chip', async () => {
        const api = loadApi();
        render(<AttendancePunchesPage />);

        await waitFor(() => expect(api.getAttendancePunches).toHaveBeenCalledTimes(1));

        fireEvent.click(chip('In / Out'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Out' }));

        await waitFor(() => {
            expect(api.getAttendancePunches).toHaveBeenLastCalledWith(
                expect.objectContaining({ direction: 'OUT' }),
            );
        });
    });

    it('opens on this month and lists the whole log once the date is cleared', async () => {
        const api = loadApi();
        render(<AttendancePunchesPage />);

        await waitFor(() => expect(api.getAttendancePunches).toHaveBeenCalledTimes(1));
        const first = api.getAttendancePunches.mock.calls[0][0];
        expect(first.startDate).toMatch(/^\d{4}-\d{2}-01$/);
        expect(first.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('narrows the rows and the summary by recorder without asking the server again', async () => {
        const api = loadApi();
        render(<AttendancePunchesPage />);
        await screen.findByText('Forgot to tap out');
        const strip = screen.getByRole('region', { name: 'In/out summary' });
        expect(within(strip).getByText('Records').parentElement).toHaveTextContent('2');

        fireEvent.click(chip('Recorded by'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Staff' }));

        await waitFor(() => expect(within(strip).getByText('Records').parentElement).toHaveTextContent('1'));
        expect(api.getAttendancePunches).toHaveBeenCalledTimes(1);
    });
});
