import { renderHook } from '@testing-library/react';
import { useDismissable } from './useDismissable';

describe('useDismissable', () => {
    function setup(enabled = true) {
        const el = document.createElement('div');
        document.body.appendChild(el);
        const inside = document.createElement('button');
        el.appendChild(inside);
        const outside = document.createElement('button');
        document.body.appendChild(outside);

        const onClose = jest.fn();
        const ref = { current: el };
        renderHook(() => useDismissable(ref, onClose, enabled));

        return { el, inside, outside, onClose };
    }

    afterEach(() => {
        document.body.innerHTML = '';
        jest.useRealTimers();
    });

    it('does not close immediately on the same tick (setTimeout guard)', () => {
        const { outside, onClose } = setup();
        outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('closes when a mousedown happens outside the ref element after the guard tick', () => {
        jest.useFakeTimers();
        const { outside, onClose } = setup();
        jest.runAllTimers();
        outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close when a mousedown happens inside the ref element', () => {
        jest.useFakeTimers();
        const { inside, onClose } = setup();
        jest.runAllTimers();
        inside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('closes on Escape keydown', () => {
        const { onClose } = setup();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not attach listeners when disabled', () => {
        jest.useFakeTimers();
        const { outside, onClose } = setup(false);
        jest.runAllTimers();
        outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('removes listeners on unmount', () => {
        jest.useFakeTimers();
        const el = document.createElement('div');
        document.body.appendChild(el);
        const onClose = jest.fn();
        const ref = { current: el };
        const { unmount } = renderHook(() => useDismissable(ref, onClose, true));
        jest.runAllTimers();
        unmount();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(onClose).not.toHaveBeenCalled();
    });
});
