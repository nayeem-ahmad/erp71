import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Textarea } from './Textarea';

describe('Textarea', () => {
    it('renders a textarea element and spreads props', () => {
        render(<Textarea placeholder="Notes" data-testid="ta" />);
        expect(screen.getByTestId('ta')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Notes')).toBeInTheDocument();
    });

    it('applies the shared control recipe classes', () => {
        render(<Textarea data-testid="ta" />);
        const el = screen.getByTestId('ta');
        expect(el).toHaveClass('w-full');
        expect(el).toHaveClass('rounded-md');
        expect(el).toHaveClass('bg-gray-50');
    });

    it('applies border-danger when error is set', () => {
        render(<Textarea data-testid="ta" error />);
        expect(screen.getByTestId('ta')).toHaveClass('border-danger');
    });

    it('forwards ref to the underlying textarea element', () => {
        const ref = createRef<HTMLTextAreaElement>();
        render(<Textarea ref={ref} />);
        expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    });

    it('drops its default w-full when the caller brings a width', () => {
        render(<Textarea data-testid="ctl" className="w-24" />);
        const el = screen.getByTestId('ctl');
        expect(el).toHaveClass('w-24');
        // Tailwind emits .w-full after .w-24, so leaving both on would hand the
        // control the whole row and collapse whatever shares the flex line.
        expect(el).not.toHaveClass('w-full');
    });

    it('keeps w-full alongside a responsive-only width override', () => {
        render(<Textarea data-testid="ctl" className="md:w-44" />);
        const el = screen.getByTestId('ctl');
        expect(el).toHaveClass('w-full');
        expect(el).toHaveClass('md:w-44');
    });

    it('keeps w-full when the caller only constrains min/max width', () => {
        render(<Textarea data-testid="ctl" className="min-w-0 max-w-[180px]" />);
        expect(screen.getByTestId('ctl')).toHaveClass('w-full');
    });
});
