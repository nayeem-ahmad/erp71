import type { Locale } from '../config';
import type { MessageDictionary } from './types';

export { enMessages } from './en';
export { type MessageDictionary } from './types';

/**
 * English is the only dictionary in the main bundle; every other language is a
 * chunk of its own, fetched by `loadMessages` (`../load-messages`).
 *
 * All nine used to be imported statically into one catalogue, which put about
 * 3.66 MB of minified JS (1 MB gzipped) into every page — `/login` included —
 * for a user who reads exactly one of them, and every deploy renamed the file
 * so everyone downloaded it all again. English stays static because it is the
 * default and the fallback: an English user waits for nothing, and a language
 * whose chunk fails to load (an offline till) still has something to show.
 *
 * Each `import()` names a single language's aggregator file, so webpack gives
 * each its own chunk; the magic comment only names the file, which makes the
 * split checkable in `.next/static/chunks`. Nothing outside `load-messages.ts`
 * should call these — it caches the result, and React needs the same promise
 * back on every render to suspend on it correctly.
 */
export const messageLoaders: Record<Exclude<Locale, 'en'>, () => Promise<MessageDictionary>> = {
    bn: () => import(/* webpackChunkName: "messages-bn" */ './bn').then((m) => m.bnMessages),
    ms: () => import(/* webpackChunkName: "messages-ms" */ './ms').then((m) => m.msMessages),
    hi: () => import(/* webpackChunkName: "messages-hi" */ './hi').then((m) => m.hiMessages),
    de: () => import(/* webpackChunkName: "messages-de" */ './de').then((m) => m.deMessages),
    fr: () => import(/* webpackChunkName: "messages-fr" */ './fr').then((m) => m.frMessages),
    es: () => import(/* webpackChunkName: "messages-es" */ './es').then((m) => m.esMessages),
    ur: () => import(/* webpackChunkName: "messages-ur" */ './ur').then((m) => m.urMessages),
    ar: () => import(/* webpackChunkName: "messages-ar" */ './ar').then((m) => m.arMessages),
};
