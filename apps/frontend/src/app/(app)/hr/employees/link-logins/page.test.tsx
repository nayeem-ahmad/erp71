import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LinkLoginsPage from './page';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
    usePathname: () => '/hr/employees/link-logins',
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

jest.mock('@/lib/api', () => ({
    api: { getEmployeeLinkSuggestions: jest.fn(), linkEmployeesBulk: jest.fn() },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = jest.requireMock('@/lib/api') as {
    api: { getEmployeeLinkSuggestions: jest.Mock; linkEmployeesBulk: jest.Mock };
};
const { toast } = jest.requireMock('@/lib/toast') as { toast: { success: jest.Mock; error: jest.Mock } };

const pair = (n: number) => ({
    employee: { id: `e${n}`, employeeCode: `EMP-${n}`, name: `Employee ${n}`, phone: `0170000000${n}`, email: null },
    user: { id: `u${n}`, name: `Login ${n}`, email: `l${n}@example.com`, mobile: `+880170000000${n}` },
    matches: ['mobile'],
});

describe('LinkLoginsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getEmployeeLinkSuggestions.mockResolvedValue([pair(1), pair(2)]);
        api.linkEmployeesBulk.mockResolvedValue({ linked: 1, results: [] });
    });

    it('starts with every clear pair ticked, and says why each matched', async () => {
        render(<LinkLoginsPage />);

        expect(await screen.findByText('Employee 1')).toBeInTheDocument();
        expect(screen.getAllByText('Same mobile')).toHaveLength(2);
        expect(screen.getByRole('button', { name: /link 2 selected/i })).toBeEnabled();
    });

    it('links only the pairs still ticked', async () => {
        render(<LinkLoginsPage />);
        await screen.findByText('Employee 1');

        fireEvent.click(screen.getByLabelText('Employee 2'));
        fireEvent.click(screen.getByRole('button', { name: /link 1 selected/i }));

        await waitFor(() =>
            expect(api.linkEmployeesBulk).toHaveBeenCalledWith([{ employeeId: 'e1', userId: 'u1' }]),
        );
        expect(toast.success).toHaveBeenCalledWith('1 linked');
        // Re-read, so a pair just linked leaves the list.
        expect(api.getEmployeeLinkSuggestions).toHaveBeenCalledTimes(2);
    });

    it('reports pairs that could not be linked', async () => {
        api.linkEmployeesBulk.mockResolvedValue({
            linked: 1,
            results: [
                { employeeId: 'e1', userId: 'u1', ok: true },
                { employeeId: 'e2', userId: 'u2', ok: false, error: 'taken' },
            ],
        });
        render(<LinkLoginsPage />);
        await screen.findByText('Employee 1');

        fireEvent.click(screen.getByRole('button', { name: /link 2 selected/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('1 could not be linked'));
    });

    it('says what to do when there is nothing clear to pair', async () => {
        api.getEmployeeLinkSuggestions.mockResolvedValue([]);
        render(<LinkLoginsPage />);

        expect(await screen.findByText(/no clear matches left/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /link 0 selected/i })).toBeDisabled();
    });
});
