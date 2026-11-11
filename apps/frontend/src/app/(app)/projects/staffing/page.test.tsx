import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StaffingPage from './page';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: {
        getProjectStaffing: jest.fn(),
    },
}));

jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: jest.fn(() => true),
}));

const getProjectStaffing = api.getProjectStaffing as jest.Mock;

const cell = (remainingHours: number, role: 'MEMBER' | 'MANAGER' | null) => ({
    role,
    isManager: role === 'MANAGER',
    remainingHours,
    openTasks: remainingHours > 0 ? 1 : 0,
    assignedNotOnTeam: false,
});

/** rina 12h on p1, karim 0h member, unassigned 8h — summary as spec. */
const payload = {
    projects: [
        { id: 'p1', code: 'ERP', shortName: 'ERP', name: 'ERP Rebuild', status: 'ACTIVE' },
    ],
    people: [
        {
            key: 'user:rina',
            kind: 'user' as const,
            id: 'rina',
            name: 'Rina',
            email: 'rina@example.com',
            noLogin: false,
            cells: { p1: cell(12, 'MEMBER') },
            totals: { projectCount: 1, remainingHours: 12, openTasks: 1 },
        },
        {
            key: 'user:karim',
            kind: 'user' as const,
            id: 'karim',
            name: 'Karim',
            email: 'karim@example.com',
            noLogin: false,
            cells: { p1: cell(0, 'MEMBER') },
            totals: { projectCount: 1, remainingHours: 0, openTasks: 0 },
        },
        {
            key: 'unassigned',
            kind: 'unassigned' as const,
            id: null,
            name: 'Unassigned',
            email: null,
            noLogin: false,
            cells: { p1: cell(8, null) },
            totals: { projectCount: 1, remainingHours: 8, openTasks: 1 },
        },
    ],
    summary: {
        people: 2,
        projects: 1,
        remainingHours: 12,
        unassignedRemainingHours: 8,
        unassignedOpenTasks: 1,
        overloaded: 0,
    },
};

beforeEach(() => {
    jest.requireMock('@/hooks/useMediaQuery').useIsMdUp.mockReturnValue(true);
    getProjectStaffing.mockReset().mockResolvedValue(payload);
});

describe('Staffing page', () => {
    it('requests ACTIVE+ON_HOLD by sending no status', async () => {
        render(<StaffingPage />);
        await waitFor(() => expect(api.getProjectStaffing).toHaveBeenCalled());
        expect(api.getProjectStaffing.mock.calls[0][0]?.status).toBeUndefined();
    });

    it('shows the summary strip and a heated cell that links to that person on that project', async () => {
        render(<StaffingPage />);
        const strip = await screen.findByRole('region', { name: /Staffing summary/i });
        expect(strip).toHaveTextContent('12');
        const cellLink = await screen.findByRole('link', { name: /12/ });
        expect(cellLink).toHaveAttribute('href', expect.stringMatching(/projectId=p1/));
        expect(cellLink).toHaveAttribute('href', expect.stringMatching(/assignee=user:rina/));
        expect(cellLink.className).toMatch(/bg-blue-600/);
    });

    it('hides idle people when asked, and keeps Unassigned', async () => {
        render(<StaffingPage />);
        fireEvent.click(await screen.findByRole('button', { name: /Hide idle/i }));
        expect(screen.queryByText('Karim')).not.toBeInTheDocument();
        expect(screen.getByText('Unassigned')).toBeInTheDocument();
    });

    it('on a phone unmounts the matrix and expands a person to their projects', async () => {
        jest.requireMock('@/hooks/useMediaQuery').useIsMdUp.mockReturnValue(false);
        render(<StaffingPage />);
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', { name: /Rina/i }));
        expect(await screen.findByText(/Member|Manager/)).toBeInTheDocument();
        const projectLink = await screen.findByRole('link', { name: /ERP Rebuild/i });
        expect(projectLink.className).toMatch(/min-h-touch/);
    });
});
