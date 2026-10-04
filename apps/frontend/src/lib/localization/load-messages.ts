import { DEFAULT_LOCALE, type Locale } from './config';
import { enMessages, messageLoaders, type MessageDictionary } from './messages';

/**
 * Dictionaries that have arrived, by locale. English is here from the start:
 * it is bundled statically, so it never needs a request.
 */
const loaded = new Map<Locale, MessageDictionary>([[DEFAULT_LOCALE, enMessages]]);

/**
 * A promise that says it has settled, the way React's `use()` reads one:
 * `status: 'fulfilled'` and its `value`. `use()` then returns the value
 * synchronously instead of suspending for a tick to find out, so a render can
 * call it every time and only a dictionary still on its way suspends.
 */
type MessagesRequest = Promise<MessageDictionary> & { status?: 'fulfilled'; value?: MessageDictionary };

function markSettled(request: MessagesRequest, messages: MessageDictionary): MessageDictionary {
    request.status = 'fulfilled';
    request.value = messages;
    return messages;
}

/**
 * One promise per locale, kept after it settles — including when it settled
 * on the English fallback.
 *
 * Keeping it is what makes this safe to call from render: `use()` needs the
 * same promise back on every attempt, or a retried render starts a fresh load
 * and suspends on it again. Keeping a *failed* one too means an offline till
 * does not refetch the chunk on every render, at the cost that the language
 * stays unavailable until the page is next loaded — when an offline device
 * would be retrying anyway.
 */
const requests = new Map<Locale, MessagesRequest>([[DEFAULT_LOCALE, alreadySettled(enMessages)]]);

function alreadySettled(messages: MessageDictionary): MessagesRequest {
    const request: MessagesRequest = Promise.resolve(messages);
    markSettled(request, messages);
    return request;
}

/**
 * The dictionary for `locale`, fetching its chunk the first time.
 *
 * Never rejects: if the chunk cannot be fetched (an offline POS, a deploy that
 * removed the old chunk mid-session) it warns and resolves to English, so the
 * screen shows English rather than nothing. Callers that must tell the two
 * apart — the language switcher should not claim to be in Bangla while showing
 * English — check `getLoadedMessages(locale)` afterwards.
 */
export function loadMessages(locale: Locale): Promise<MessageDictionary> {
    const pending = requests.get(locale);
    if (pending) return pending;

    // Started inside `then` so that a locale with no loader fails the same way
    // a failed fetch does — English and a warning, not a throw during render.
    // Marked settled in the same step that records it as loaded, so nothing
    // can see the one without the other.
    const request: MessagesRequest = Promise.resolve()
        .then(() => messageLoaders[locale as Exclude<Locale, 'en'>]())
        .then(
            (messages) => {
                loaded.set(locale, messages);
                return markSettled(request, messages);
            },
            (error: unknown) => {
                console.warn(`Could not load the "${locale}" messages; showing English instead.`, error);
                return markSettled(request, enMessages);
            },
        );

    requests.set(locale, request);
    return request;
}

/**
 * The dictionary for `locale` if it has already arrived, synchronously.
 * `undefined` while it is still loading, and for good if its load failed.
 */
export function getLoadedMessages(locale: Locale): MessageDictionary | undefined {
    return loaded.get(locale);
}

/**
 * For the few places that cannot wait or suspend — the global error page, the
 * print window — and only ever need the language already on screen: its
 * dictionary if loaded, English otherwise.
 */
export function getLoadedMessagesOrDefault(locale: Locale): MessageDictionary {
    return loaded.get(locale) ?? enMessages;
}
