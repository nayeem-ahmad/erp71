import { fireEvent, render, screen } from '@testing-library/react';
import AccountFormModal from './AccountFormModal';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    api: {
        createAccount: jest.fn(),
        updateAccount: jest.fn(),
        getNextAccountCode: jest.fn().mockResolvedValue({ code: '110101' }),
        getStores: jest.fn().mockResolvedValue([
            { id: 'store-a', name: 'Babu Bazar' },
            { id: 'store-b', name: 'Press Club' },
        ]),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const groups = [{ id: 'g1', name: 'Current Assets', code: '11', type: 'asset' as const }];

function open() {
    render(
        <AccountFormModal
            account={null}
            groups={groups}
            subgroups={[]}
            onClose={() => {}}
            onSaved={() => {}}
        />,
    );
    fireEvent.change(screen.getByLabelText('Account group'), { target: { value: 'g1' } });
    fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Main Cash' } });
}

describe('AccountFormModal branch', () => {
    beforeEach(() => {
        (api.createAccount as jest.Mock).mockReset();
    });

    it('requires a branch on a cash drawer and hides it for a bank', () => {
        open();
        fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cash' } });

        expect(screen.getByLabelText('Branch')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
        expect(api.createAccount).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'bank' } });
        expect(screen.queryByLabelText('Branch')).not.toBeInTheDocument();
    });

    it('saves a linked wallet with no branch', () => {
        render(
            <AccountFormModal
                account={{
                    id: 'upay',
                    name: 'Upay',
                    code: '110104',
                    type: 'asset',
                    category: 'cash',
                    store_id: null,
                    linked_wallet: true,
                    group: groups[0],
                }}
                groups={groups}
                subgroups={[]}
                onClose={() => {}}
                onSaved={() => {}}
            />,
        );

        expect(screen.queryByLabelText('Branch')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Update Account' }));
        expect(api.updateAccount).toHaveBeenCalledWith('upay', expect.objectContaining({
            name: 'Upay',
            category: 'cash',
            storeId: null,
        }));
    });

    it('saves a new shared wallet with no branch before it is linked', () => {
        open();
        fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Upay' } });
        fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cash' } });
        fireEvent.click(screen.getByLabelText('Shared wallet, not a drawer'));

        expect(screen.queryByLabelText('Branch')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
        expect(api.createAccount).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Upay',
            category: 'cash',
            type: 'asset',
            storeId: null,
        }));
    });
});
