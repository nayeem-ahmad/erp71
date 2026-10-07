import { render, screen } from '@testing-library/react';
import VoiceNavWidget from './VoiceNavWidget';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
}));

describe('VoiceNavWidget', () => {
    it('is a single mic button — the examples no longer sit behind a `?` of their own', () => {
        render(<VoiceNavWidget />);

        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Voice navigation — speak a page name' })).toBeInTheDocument();
        // The examples belong to the listening state, not to an idle header.
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});
