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
});
