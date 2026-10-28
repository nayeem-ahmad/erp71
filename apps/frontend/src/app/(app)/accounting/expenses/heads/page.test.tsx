import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ExpenseHeadsPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
    useSearchParams: () => ({ get: () => null }),
    usePathname: () => '/accounting/expenses/heads',
}));

jest.mock('next/link', () => {
    return ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
        <a href={href} {...rest}>{children}</a>
    );
});

jest.mock('@/components/data-table', () => ({
    DataTable: (props: {
        filterLayout?: string;
        viewOptions?: boolean;
        data?: Array<{ id: string; name: string }>;
        filters?: Array<{ id: string; onChange?: (next: string[]) => void }>;
    }) => (
        <div data-testid="data-table" data-filter-layout={props.filterLayout} data-view-options={String(Boolean(props.viewOptions))}>
            <span data-testid="row-count">{props.data?.length ?? 0}</span>
            <button type="button" onClick={() => props.filters?.find((filter) => filter.id === 'category')?.onChange?.(['cat-rent'])}>
                Rent only
            </button>
            {(props.data ?? []).map((row) => <span key={row.id}>{row.name}</span>)}
        </div>
    ),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getExpenseCategories: jest.fn(),
        createExpenseHead: jest.fn(),
        getAccounts: jest.fn(),
    },
}));

const salary = {
    id: 'cat-salary',
    name: 'Salary',
    account_id: 'acct-salary',
    account: { id: 'acct-salary', name: 'Salary & Wages', code: '510202' },
    heads: [
        { id: 'head-karim', name: 'Salary - Karim', category_id: 'cat-salary', _count: { entries: 2 } },
    ],
};

const rent = {
    id: 'cat-rent',
    name: 'Rent',
    heads: [
        { id: 'head-shop', name: 'Shop rent', category_id: 'cat-rent', _count: { entries: 1 } },
    ],
};

describe('ExpenseHeadsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getExpenseCategories as jest.Mock).mockResolvedValue([salary, rent]);
        (api.getAccounts as jest.Mock).mockResolvedValue([
            { id: 'acct-salary', name: 'Salary & Wages', code: '510202', type: 'expense' },
        ]);
        (api.createExpenseHead as jest.Mock).mockResolvedValue({ id: 'head-new' });
    });

    it('uses the expenses list layout and narrows by category', async () => {
        render(<ExpenseHeadsPage />);

        const table = await screen.findByTestId('data-table');
        expect(table).toHaveAttribute('data-filter-layout', 'row');
        expect(table).toHaveAttribute('data-view-options', 'true');
        expect(await screen.findByTestId('row-count')).toHaveTextContent('2');

        fireEvent.click(screen.getByRole('button', { name: /rent only/i }));
        expect(screen.getByTestId('row-count')).toHaveTextContent('1');
        expect(screen.getByText('Shop rent')).toBeInTheDocument();
        expect(api.getExpenseCategories).toHaveBeenCalledTimes(1);
    });

    it('lets a head use the category account', async () => {
        (api.getExpenseCategories as jest.Mock).mockResolvedValue([{ ...salary, heads: [] }]);
        render(<ExpenseHeadsPage />);

        fireEvent.click(await screen.findByRole('button', { name: /add head/i }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByRole('combobox', { name: /^category$/i }), { target: { value: 'cat-salary' } });
        expect(within(dialog).getByRole('button', { name: /expense account/i })).toHaveTextContent(/category account/i);
        expect(within(dialog).getByRole('button', { name: /expense account/i })).toHaveTextContent(/salary & wages/i);

        fireEvent.change(within(dialog).getByRole('textbox', { name: /expense head/i }), { target: { value: 'Salary - Karim' } });
        fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));

        await waitFor(() =>
            expect(api.createExpenseHead).toHaveBeenCalledWith(
                expect.objectContaining({
                    categoryId: 'cat-salary',
                    name: 'Salary - Karim',
                    accountId: null,
                }),
            ),
        );
    });
});
