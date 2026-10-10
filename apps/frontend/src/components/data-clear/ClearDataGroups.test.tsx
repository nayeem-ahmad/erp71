import { fireEvent, render, screen } from '@testing-library/react';
import ClearDataGroups, { allGroups, keptGroups, type DataGroup } from './ClearDataGroups';

function renderGroups(scope: 'tenant' | 'branch', deleting: Set<DataGroup> = allGroups(scope)) {
    const onChange = jest.fn();
    render(<ClearDataGroups scope={scope} deleting={deleting} onChange={onChange} />);
    return onChange;
}

describe('ClearDataGroups', () => {
    it('offers every master data group for the whole tenant, all ticked', () => {
        renderGroups('tenant');

        for (const label of ['Products & pricing', 'Stock levels', 'Customers', 'Suppliers',
            'Employees & HR setup', 'Projects', 'Finance setup', 'Other']) {
            expect(screen.getByRole('checkbox', { name: new RegExp(label) })).toBeChecked();
        }
    });

    it("offers a branch only its own customers, suppliers and stock — never products", () => {
        renderGroups('branch');

        expect(screen.getAllByRole('checkbox')).toHaveLength(3);
        expect(screen.queryByRole('checkbox', { name: /Products/ })).not.toBeInTheDocument();
        expect(screen.getByText(/Products are shared by every branch/)).toBeInTheDocument();
    });

    it('unticking a group keeps it', () => {
        const onChange = renderGroups('tenant');

        fireEvent.click(screen.getByRole('checkbox', { name: /Customers/ }));

        const next: Set<DataGroup> = onChange.mock.calls[0][0];
        expect(next.has('customers')).toBe(false);
        expect(keptGroups('tenant', next)).toEqual(['customers']);
    });

    it('holds stock ticked while products are, since it goes with them', () => {
        renderGroups('tenant');

        const stock = screen.getByRole('checkbox', { name: /Stock levels/ });
        expect(stock).toBeChecked();
        expect(stock).toBeDisabled();
    });

    it('frees the stock once products are kept', () => {
        const deleting = allGroups('tenant');
        deleting.delete('products');
        renderGroups('tenant', deleting);

        expect(screen.getByRole('checkbox', { name: /Stock levels/ })).toBeEnabled();
    });
});
