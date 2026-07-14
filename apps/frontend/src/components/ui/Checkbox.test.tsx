import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
    it('renders a checkbox input', () => {
        render(<Checkbox data-testid="cb" />);
        const el = screen.getByTestId('cb') as HTMLInputElement;
        expect(el).toBeInTheDocument();
        expect(el.type).toBe('checkbox');
    });

    it('applies primary tint classes', () => {
        render(<Checkbox data-testid="cb" />);
        const el = screen.getByTestId('cb');
        expect(el).toHaveClass('text-primary');
    });

    it('forwards ref to the underlying input element', () => {
        const ref = createRef<HTMLInputElement>();
        render(<Checkbox ref={ref} />);
        expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });

    it('can be checked and disabled', () => {
        render(<Checkbox data-testid="cb" checked readOnly disabled />);
        const el = screen.getByTestId('cb') as HTMLInputElement;
        expect(el.checked).toBe(true);
        expect(el).toBeDisabled();
    });

    it('merges a custom className', () => {
        render(<Checkbox data-testid="cb" className="custom-class" />);
        expect(screen.getByTestId('cb')).toHaveClass('custom-class');
    });
});
