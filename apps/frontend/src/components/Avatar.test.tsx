import { render, screen } from '@testing-library/react';
import Avatar, { initialsOf } from './Avatar';

describe('initialsOf', () => {
    it('takes the first letter of the first two words', () => {
        expect(initialsOf('Rahim Uddin')).toBe('RU');
    });

    it('caps at two letters however many words there are', () => {
        expect(initialsOf('Md Rahim Uddin Khan')).toBe('MR');
    });

    it('handles a single name', () => {
        expect(initialsOf('Rahim')).toBe('R');
    });

    it('falls back to a placeholder for a blank name', () => {
        expect(initialsOf('   ')).toBe('?');
    });

    it('ignores extra whitespace between words', () => {
        expect(initialsOf('Rahim    Uddin')).toBe('RU');
    });
});

describe('Avatar', () => {
    it('renders the photo when there is one', () => {
        render(<Avatar src="https://cdn.example/rahim.jpg" name="Rahim Uddin" />);
        const img = screen.getByRole('img', { name: 'Rahim Uddin' });
        expect(img).toHaveAttribute('src', 'https://cdn.example/rahim.jpg');
    });

    it('renders initials when there is no photo', () => {
        render(<Avatar src={null} name="Rahim Uddin" />);
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.getByText('RU')).toBeInTheDocument();
    });

    it('treats an empty string as no photo', () => {
        render(<Avatar src="" name="Rahim Uddin" />);
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });
});
