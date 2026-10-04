import { enMessages, type MessageDictionary } from './messages';
import { bnMessages } from './messages/bn';

/**
 * The cache is module state, so every test takes a fresh copy of the module —
 * and of the loaders it calls, so a spy lands on the instance it will use.
 */
function freshLoader() {
    let loader!: typeof import('./load-messages');
    let messages!: typeof import('./messages');
    jest.isolateModules(() => {
        loader = require('./load-messages');
        messages = require('./messages');
    });
    return { ...loader, messageLoaders: messages.messageLoaders };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('loadMessages', () => {
    afterEach(() => jest.restoreAllMocks());

    it('has English synchronously, without fetching anything', async () => {
        const { getLoadedMessages, loadMessages, messageLoaders } = freshLoader();
        const fetches = (Object.keys(messageLoaders) as (keyof typeof messageLoaders)[]).map((locale) =>
            jest.spyOn(messageLoaders, locale),
        );

        // `toEqual`, not `toBe`: the isolated copy has its own instance of the
        // English module, the same content.
        expect(getLoadedMessages('en')).toEqual(enMessages);
        // Settled from the start, so `use()` never suspends for English.
        expect(loadMessages('en')).toMatchObject({ status: 'fulfilled', value: getLoadedMessages('en') });
        await expect(loadMessages('en')).resolves.toEqual(enMessages);
        for (const fetch of fetches) expect(fetch).not.toHaveBeenCalled();
    });

    it('shares one request between concurrent callers, then answers from the cache', async () => {
        const { getLoadedMessages, loadMessages, messageLoaders } = freshLoader();
        const chunk = deferred<MessageDictionary>();
        const fetch = jest.spyOn(messageLoaders, 'bn').mockReturnValue(chunk.promise);

        const first = loadMessages('bn');
        const second = loadMessages('bn');

        expect(second).toBe(first);
        expect(getLoadedMessages('bn')).toBeUndefined();

        chunk.resolve(bnMessages);
        await expect(first).resolves.toBe(bnMessages);

        expect(getLoadedMessages('bn')).toBe(bnMessages);
        // The settled promise itself comes back, marked the way `use()` reads
        // it, so a render gets the dictionary without suspending again.
        expect(loadMessages('bn')).toBe(first);
        expect(first).toMatchObject({ status: 'fulfilled', value: bnMessages });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('falls back to English with a warning when the chunk cannot be fetched', async () => {
        const { getLoadedMessages, getLoadedMessagesOrDefault, loadMessages, messageLoaders } = freshLoader();
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const fetch = jest
            .spyOn(messageLoaders, 'bn')
            .mockRejectedValue(new Error('Loading chunk messages-bn failed.'));

        const english = getLoadedMessages('en');
        await expect(loadMessages('bn')).resolves.toBe(english);

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('"bn"'),
            expect.objectContaining({ message: 'Loading chunk messages-bn failed.' }),
        );
        // Still not "loaded": callers can tell the fallback from the real thing.
        expect(getLoadedMessages('bn')).toBeUndefined();
        expect(getLoadedMessagesOrDefault('bn')).toBe(english);

        // A render retrying must get the same settled promise, not a fresh
        // fetch — an offline till would otherwise refetch on every render.
        await loadMessages('bn');
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
