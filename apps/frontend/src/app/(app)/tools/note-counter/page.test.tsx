import { fireEvent, render, screen } from '@testing-library/react';
import NoteCounterPage from './page';

jest.mock('@/lib/api', () => ({ api: { createNote: jest.fn() } }));

describe('NoteCounterPage', () => {
    beforeEach(() => window.localStorage.clear());

    it('totals the notes and says how far it is from what is expected', () => {
        render(<NoteCounterPage />);
        fireEvent.change(screen.getByLabelText('Count ৳1000'), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: '+ ৳500' }));
        fireEvent.change(screen.getByLabelText('Coins and loose change (Tk)'), { target: { value: '7' } });
        expect(screen.getByText(/2,507\.00/)).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Should be in the drawer (Tk)'), { target: { value: '2600' } });
        expect(screen.getByText(/Short by/)).toHaveTextContent('93.00');
    });

    it('keeps the count across a reload', () => {
        const { unmount } = render(<NoteCounterPage />);
        fireEvent.change(screen.getByLabelText('Count ৳100'), { target: { value: '5' } });
        unmount();
        render(<NoteCounterPage />);
        expect(screen.getByLabelText('Count ৳100')).toHaveValue(5);
    });
});
