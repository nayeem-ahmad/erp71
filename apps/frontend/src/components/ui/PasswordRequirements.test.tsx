import { render, screen } from '@testing-library/react';
import { DEFAULT_PASSWORD_POLICY, type PasswordPolicy } from '@erp71/shared-types';
import { PasswordRequirements } from './PasswordRequirements';

jest.mock('@/lib/i18n', () => {
    const { enMessages } = jest.requireActual('@/lib/localization/messages/en');
    return { useI18n: () => ({ t: enMessages }) };
});

const policy = (overrides: Partial<PasswordPolicy> = {}): PasswordPolicy => ({
    ...DEFAULT_PASSWORD_POLICY,
    ...overrides,
});

describe('PasswordRequirements', () => {
    it('lists only the rules the workspace turned on', () => {
        render(<PasswordRequirements password="" policy={policy({ block_common: false })} />);

        expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
        expect(screen.queryByText('An uppercase letter')).not.toBeInTheDocument();
        expect(screen.queryByText('A symbol')).not.toBeInTheDocument();
    });

    it('names the workspace minimum rather than a hardcoded eight', () => {
        render(<PasswordRequirements password="" policy={policy({ min_length: 14 })} />);

        expect(screen.getByText('At least 14 characters')).toBeInTheDocument();
    });

    it('marks a rule green once it is met and red once it is not', () => {
        const { rerender } = render(
            <PasswordRequirements password="short" policy={policy({ block_common: false })} />,
        );
        expect(screen.getByText('At least 8 characters').parentElement).toHaveClass('text-red-600');

        rerender(<PasswordRequirements password="long-enough" policy={policy({ block_common: false })} />);
        expect(screen.getByText('At least 8 characters').parentElement).toHaveClass('text-emerald-600');
    });

    it('stays neutral before the first keystroke rather than scolding', () => {
        render(<PasswordRequirements password="" policy={policy()} touched={false} />);

        expect(screen.getByText('At least 8 characters').parentElement).toHaveClass('text-gray-500');
    });

    it('falls back to the platform default while the policy is still loading', () => {
        render(<PasswordRequirements password="" policy={null} />);

        expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
        expect(screen.getByText('Not a commonly used password')).toBeInTheDocument();
    });

    it('flags a common password even when every other rule is met', () => {
        render(<PasswordRequirements password="Password123!" policy={policy({ require_symbol: true })} />);

        expect(screen.getByText('Not a commonly used password').parentElement).toHaveClass('text-red-600');
        expect(screen.getByText('A symbol').parentElement).toHaveClass('text-emerald-600');
    });
});
