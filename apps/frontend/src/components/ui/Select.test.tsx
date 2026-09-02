import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Select } from './Select';

describe('Select', () => {
    it('renders a select element with options', () => {
        render(
            <Select data-testid="sel">
                <option value="a">A</option>
                <option value="b">B</option>
            </Select>,
        );
        expect(screen.getByTestId('sel')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'A' })).toBeInTheDocument();
    });

    it('applies the shared control recipe classes', () => {
        render(<Select data-testid="sel" />);
        const el = screen.getByTestId('sel');
        expect(el).toHaveClass('w-full');
        expect(el).toHaveClass('rounded-md');
        expect(el).toHaveClass('border-gray-200');
    });

    it('applies border-danger when error is set', () => {
        render(<Select data-testid="sel" error />);
        expect(screen.getByTestId('sel')).toHaveClass('border-danger');
    });

    it('forwards ref to the underlying select element', () => {
        const ref = createRef<HTMLSelectElement>();
        render(<Select ref={ref} />);
        expect(ref.current).toBeInstanceOf(HTMLSelectElement);
    });

    it('respects the disabled attribute', () => {
        render(<Select data-testid="sel" disabled />);
        expect(screen.getByTestId('sel')).toBeDisabled();
    });

    it('drops its default w-full when the caller brings a width', () => {
        render(<Select data-testid="ctl" className="w-24" />);
        const el = screen.getByTestId('ctl');
        expect(el).toHaveClass('w-24');
        // Tailwind emits .w-full after .w-24, so leaving both on would hand the
        // control the whole row and collapse whatever shares the flex line.
        expect(el).not.toHaveClass('w-full');
    });

    it('keeps w-full alongside a responsive-only width override', () => {
        render(<Select data-testid="ctl" className="md:w-44" />);
        const el = screen.getByTestId('ctl');
        expect(el).toHaveClass('w-full');
        expect(el).toHaveClass('md:w-44');
    });

    it('keeps w-full when the caller only constrains min/max width', () => {
        render(<Select data-testid="ctl" className="min-w-0 max-w-[180px]" />);
        expect(screen.getByTestId('ctl')).toHaveClass('w-full');
    });
});
