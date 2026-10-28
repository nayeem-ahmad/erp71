import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ExpenseCategoriesPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
    useSearchParams: () => ({ get: () => null }),
    usePathname: () => '/accounting/expenses/categories',
}));

jest.mock('next/link', () => {
    return ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
        <a href={href} {...rest}>{children}</a>
    );
});

jest.mock('@/components/data-table', () => ({
    DataTable: ({ data, columns, filterLayout, viewOptions }: { data: Array<{ id: string }>; filterLayout?: string; viewOptions?: boolean; columns: Array<{ id?: string; cell?: (ctx: { row: { original: unknown } }) => React.ReactNode }> }) => (
        <div data-testid="data-table" data-filter-layout={filterLayout} data-view-options={String(Boolean(viewOptions))}>
            {data.map((row) => (
                <div key={row.id}>
                    {columns.filter((column) => column.id === 'heads').map((column) => (
                        <span key={column.id}>{column.cell?.({ row: { original: row } })}</span>
                    ))}
                </div>
            ))}
        </div>
    ),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getExpenseCategories: jest.fn(),
        createExpenseCategory: jest.fn(),
        updateExpenseCategory: jest.fn(),
        createExpenseHead: jest.fn(),
        getAccounts: jest.fn(),
    },
}));

describe('ExpenseCategoriesPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getExpenseCategories as jest.Mock).mockResolvedValue([]);
        (api.getAccounts as jest.Mock).mockResolvedValue([
            { id: 'acct-rent', name: 'Rent Expense', code: '510206', type: 'expense' },
            { id: 'acct-salary', name: 'Salary & Wages', code: '510202', type: 'expense' },
        ]);
        (api.createExpenseCategory as jest.Mock).mockResolvedValue({ id: 'cat-1' });
        (api.createExpenseHead as jest.Mock).mockResolvedValue({ id: 'head-1' });
    });

    it('saves a category against a chosen expense account', async () => {
        render(<ExpenseCategoriesPage />);

        const table = await screen.findByTestId('data-table');
        expect(table).toHaveAttribute('data-filter-layout', 'row');
        expect(table).toHaveAttribute('data-view-options', 'true');

        fireEvent.click(await screen.findByRole('button', { name: /add category/i }));

        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByRole('textbox', { name: /^category$/i }), { target: { value: 'Rent' } });
        fireEvent.click(within(dialog).getByRole('button', { name: /expense account/i }));
        fireEvent.click(await screen.findByRole('option', { name: /rent expense/i }));
        fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));

        await waitFor(() =>
            expect(api.createExpenseCategory).toHaveBeenCalledWith({
                name: 'Rent',
                description: undefined,
                accountId: 'acct-rent',
            }),
        );
        expect(api.getAccounts).toHaveBeenCalledWith({ type: 'expense' });
    });

    it('leaves the account blank so the category posts to the default', async () => {
        render(<ExpenseCategoriesPage />);

        fireEvent.click(await screen.findByRole('button', { name: /add category/i }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByRole('textbox', { name: /^category$/i }), { target: { value: 'Conveyance' } });
        fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));

        await waitFor(() =>
            expect(api.createExpenseCategory).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Conveyance', accountId: null }),
            ),
        );
    });
});
