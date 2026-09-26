import { resolveLocale } from '@/lib/localization/config';
import { messageCatalog } from '@/lib/localization/messages';

export interface PrintWindowLabels {
    print: string;
    close: string;
    compact: string;
    compactHint: string;
}

/**
 * The print window's own wording, in the language the app is showing.
 *
 * Looked up here rather than passed in: the window is opened by a dozen
 * printers, most of them plain functions with no `t` of their own, and these
 * words are the same for every document. The app marks the active locale on
 * `<html>` (`applyLocaleToDocument`), so a language switch is followed without
 * a reload.
 */
export function printWindowLabels(): PrintWindowLabels {
    const marked = typeof document === 'undefined'
        ? undefined
        : document.documentElement.dataset.locale;
    const copy = messageCatalog[resolveLocale(marked)];

    return {
        print: copy.common.print,
        close: copy.common.close,
        compact: copy.components.printWindow.compact,
        compactHint: copy.components.printWindow.compactHint,
    };
}
