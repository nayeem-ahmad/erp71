import { fireEvent, render, screen } from '@testing-library/react';
import AmountInWordsPage from './page';

describe('AmountInWordsPage', () => {
    it('writes an amount in English, Bangla and Bangla digits', () => {
        render(<AmountInWordsPage />);
        fireEvent.change(screen.getByLabelText('Amount (Tk)'), { target: { value: '১২৫০০০.৫০' } });
        expect(screen.getByText('Taka One Lakh Twenty Five Thousand and Fifty Paisa Only')).toBeInTheDocument();
        expect(screen.getByText('এক লক্ষ পঁচিশ হাজার টাকা পঞ্চাশ পয়সা মাত্র')).toBeInTheDocument();
        expect(screen.getByText('৳১,২৫,০০০.৫০')).toBeInTheDocument();
    });
});
