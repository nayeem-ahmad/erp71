import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Input } from './Input';

describe('Input', () => {
    it('renders an input element and spreads props', () => {
        render(<Input placeholder="Name" data-testid="name-input" />);
        expect(screen.getByTestId('name-input')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Name')).toBeInTheDocument();
    });

    it('applies the shared control recipe classes', () => {
        render(<Input data-testid="ctl" />);
        const el = screen.getByTestId('ctl');
        expect(el).toHaveClass('w-full');
        expect(el).toHaveClass('rounded-md');
        expect(el).toHaveClass('border-gray-200');
        expect(el).toHaveClass('bg-gray-50');
    });

    it('applies border-danger when error is set', () => {
        render(<Input data-testid="ctl" error />);
        expect(screen.getByTestId('ctl')).toHaveClass('border-danger');
    });

    it('does not apply border-danger by default', () => {
        render(<Input data-testid="ctl" />);
        expect(screen.getByTestId('ctl')).not.toHaveClass('border-danger');
    });

    it('forwards ref to the underlying input element', () => {
        const ref = createRef<HTMLInputElement>();
        render(<Input ref={ref} />);
        expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });

    it('merges a custom className with the base classes', () => {
        render(<Input data-testid="ctl" className="custom-class" />);
        const el = screen.getByTestId('ctl');
        expect(el).toHaveClass('custom-class');
        expect(el).toHaveClass('w-full');
    });

    it('respects the disabled attribute', () => {
        render(<Input data-testid="ctl" disabled />);
        expect(screen.getByTestId('ctl')).toBeDisabled();
    });
});
