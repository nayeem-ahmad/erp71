import { render, screen } from '@testing-library/react';
import ShareModal from './ShareModal';

describe('ShareModal', () => {
    const original = window.location.origin;

    it('shows the absolute short URL', () => {
        render(<ShareModal title="Quotation Q-1001" shortPath="/s/aB3xK9m" onClose={() => {}} />);
        expect(screen.getByDisplayValue(`${original}/s/aB3xK9m`)).toBeInTheDocument();
    });

    it('offers a WhatsApp share containing the link', () => {
        render(<ShareModal title="Quotation Q-1001" shortPath="/s/aB3xK9m" onClose={() => {}} />);
        const whatsapp = screen.getByRole('link', { name: /whatsapp/i });
        expect(whatsapp).toHaveAttribute('href', expect.stringContaining('wa.me'));
        expect(whatsapp.getAttribute('href')).toContain(encodeURIComponent(`${original}/s/aB3xK9m`));
    });
});
