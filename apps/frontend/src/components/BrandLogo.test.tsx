import { render, screen } from '@testing-library/react';

import BrandLogo from './BrandLogo';
import { BRAND_NAME } from '@/lib/brand';

describe('BrandLogo', () => {
    it('renders the full lockup by default, labelled with the brand name', () => {
        render(<BrandLogo />);
        const img = screen.getByAltText(BRAND_NAME);
        expect(img).toHaveAttribute('src', expect.stringContaining('/logo/logo.svg'));
    });

    it('renders the mark-only asset for variant="mark"', () => {
        render(<BrandLogo variant="mark" />);
        expect(screen.getByAltText(BRAND_NAME)).toHaveAttribute('src', expect.stringContaining('/logo/icon.svg'));
    });

    it('renders the reverse lockup on coloured backgrounds', () => {
        render(<BrandLogo tone="reverse" />);
        expect(screen.getByAltText(BRAND_NAME)).toHaveAttribute('src', expect.stringContaining('/logo/reverse-logo.svg'));
    });

    it('renders the reverse mark on coloured backgrounds', () => {
        render(<BrandLogo variant="mark" tone="reverse" />);
        expect(screen.getByAltText(BRAND_NAME)).toHaveAttribute('src', expect.stringContaining('/logo/reverse-icon.svg'));
    });

    it('scales width from the asset aspect ratio so the lockup never squashes', () => {
        render(<BrandLogo height={32} />);
        const img = screen.getByAltText(BRAND_NAME);
        // Lockup artwork is 2200x860, so 32px tall is 82px wide.
        expect(img).toHaveAttribute('height', '32');
        expect(img).toHaveAttribute('width', '82');
    });

    it('keeps the mark square', () => {
        render(<BrandLogo variant="mark" height={40} />);
        const img = screen.getByAltText(BRAND_NAME);
        expect(img).toHaveAttribute('height', '40');
        expect(img).toHaveAttribute('width', '40');
    });

    it('wraps the logo in a link when href is given', () => {
        render(<BrandLogo href="/" />);
        expect(screen.getByRole('link', { name: BRAND_NAME })).toHaveAttribute('href', '/');
    });

    it('renders no link when href is omitted', () => {
        render(<BrandLogo />);
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('marks the logo decorative when a visible wordmark sits beside it', () => {
        render(<BrandLogo variant="mark" decorative />);
        const img = screen.getByRole('presentation', { hidden: true });
        expect(img).toHaveAttribute('alt', '');
    });
});
