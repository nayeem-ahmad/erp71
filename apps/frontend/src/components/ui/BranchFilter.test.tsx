import { fireEvent, render, screen } from '@testing-library/react';
import { BranchFilter, type BranchFilterProps } from './BranchFilter';

jest.mock('@/lib/i18n', () => {
    const { enMessages } = jest.requireActual('@/lib/localization/messages/en');
    return { useI18n: () => ({ t: enMessages }) };
});

const scope = (overrides: Partial<BranchFilterProps['scope']> = {}): BranchFilterProps['scope'] => ({
    branches: [
        { id: 'A', name: 'Dhanmondi' },
        { id: 'B', name: 'Mirpur' },
    ],
    value: 'A',
    setValue: jest.fn(),
    canSeeAll: false,
    locked: false,
    hidden: false,
    ready: true,
    ...overrides,
});

describe('BranchFilter', () => {
    it('lists the member’s branches and reports a change', () => {
        const props = scope();
        render(<BranchFilter scope={props} />);
        const select = screen.getByRole('combobox', { name: 'Branch' });
        expect(select).toHaveValue('A');
        expect(screen.queryByRole('option', { name: 'All branches' })).not.toBeInTheDocument();
        fireEvent.change(select, { target: { value: 'B' } });
        expect(props.setValue).toHaveBeenCalledWith('B');
    });

    it('puts "All branches" first when the member may see the whole company', () => {
        render(<BranchFilter scope={scope({ canSeeAll: true, value: 'all' })} />);
        const options = screen.getAllByRole('option');
        expect(options[0]).toHaveTextContent('All branches');
        expect(screen.getByRole('combobox')).toHaveValue('all');
    });

    it('is disabled, with a hint, for a member limited to one branch', () => {
        render(<BranchFilter scope={scope({ branches: [{ id: 'A', name: 'Dhanmondi' }], locked: true })} />);
        const select = screen.getByRole('combobox');
        expect(select).toBeDisabled();
        expect(select).toHaveAccessibleDescription('You have access to this branch only');
    });

    it('renders nothing in a one-branch shop or before /auth/me is in', () => {
        const { container, rerender } = render(<BranchFilter scope={scope({ hidden: true })} />);
        expect(container).toBeEmptyDOMElement();
        rerender(<BranchFilter scope={scope({ ready: false })} />);
        expect(container).toBeEmptyDOMElement();
    });
});
