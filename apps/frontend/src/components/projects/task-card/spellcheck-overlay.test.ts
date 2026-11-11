import { eventTouchesSpellcheckOverlay, isSpellcheckOverlay } from './spellcheck-overlay';

describe('isSpellcheckOverlay', () => {
    it('recognises a Grammarly host', () => {
        const popup = document.createElement('grammarly-popups');
        expect(isSpellcheckOverlay(popup)).toBe(true);
        expect(isSpellcheckOverlay(document.createElement('div'))).toBe(false);
        expect(isSpellcheckOverlay(null)).toBe(false);
    });

    it('walks out of a shadow root to the Grammarly host', () => {
        const host = document.createElement('grammarly-extension');
        const root = host.attachShadow({ mode: 'open' });
        const suggestion = document.createElement('button');
        suggestion.textContent = 'Date-wise';
        root.appendChild(suggestion);
        expect(isSpellcheckOverlay(suggestion)).toBe(true);
    });
});

describe('eventTouchesSpellcheckOverlay', () => {
    it('sees a Grammarly host on composedPath', () => {
        const popup = document.createElement('grammarly-popups');
        const event = new Event('pointerdown');
        Object.defineProperty(event, 'composedPath', { value: () => [popup] });
        expect(eventTouchesSpellcheckOverlay(event)).toBe(true);
    });
});
