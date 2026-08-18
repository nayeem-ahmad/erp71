import { fireEvent, render, screen } from '@testing-library/react';
import SupportComposer, {
    availableKnockCategories,
    defaultKnockCategory,
} from './SupportComposer';

jest.mock('@/lib/api', () => ({
    api: {
        createSupportThread: jest.fn(),
    },
}));

describe('availableKnockCategories', () => {
    it('includes help only when support is on', () => {
        expect(availableKnockCategories(true, false)).toEqual(['support']);
    });

    it('includes feedback types only when feedback is on', () => {
        expect(availableKnockCategories(false, true)).toEqual(['bug', 'feature', 'general']);
    });

    it('includes every type when both flags are on', () => {
        expect(availableKnockCategories(true, true)).toEqual(['support', 'bug', 'feature', 'general']);
    });
});

describe('defaultKnockCategory', () => {
    it('prefers help when support is on', () => {
        expect(defaultKnockCategory(true, true)).toBe('support');
    });

    it('falls back to other when only feedback is on', () => {
        expect(defaultKnockCategory(false, true)).toBe('general');
    });
});

describe('SupportComposer', () => {
    it('hides the help chip when support is off', () => {
        render(
            <SupportComposer
                supportEnabled={false}
                feedbackEnabled
                onCreated={jest.fn()}
                onCancel={jest.fn()}
            />,
        );
        expect(screen.queryByRole('button', { name: 'I need help' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Bug' })).toBeInTheDocument();
    });

    it('hides feedback chips when feedback is off', () => {
        render(
            <SupportComposer
                supportEnabled
                feedbackEnabled={false}
                onCreated={jest.fn()}
                onCancel={jest.fn()}
            />,
        );
        expect(screen.queryByRole('button', { name: 'Bug' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'I need help' })).not.toBeInTheDocument();
    });

    it('lets the user pick a type when both flags are on', () => {
        render(
            <SupportComposer
                supportEnabled
                feedbackEnabled
                onCreated={jest.fn()}
                onCancel={jest.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: 'I need help' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Feature' }));
        expect(screen.getByPlaceholderText('Describe the bug, idea, or other feedback…')).toBeInTheDocument();
    });
});
