import { lazy } from 'react';

/**
 * Rendered, not stored: descriptions are markdown text, and react-markdown is
 * heavy enough to be worth keeping out of the bundle until a card is opened.
 */
export const Markdown = lazy(() => import('@/components/ui/Markdown'));
