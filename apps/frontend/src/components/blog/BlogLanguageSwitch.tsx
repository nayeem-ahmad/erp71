import Link from 'next/link';
import { BLOG_LOCALES, blogHref, blogStrings, type BlogLocale } from '@/lib/blog/locale';
import { localeRegistry } from '@/lib/localization/config';

/**
 * English ⇄ বাংলা, as two links.
 *
 * Deliberately not a client-side toggle. A `<button>` that swapped the text in
 * place would give the Bangla version no URL — nothing to share, nothing for a
 * crawler to index, nothing to come back to — which would leave the
 * translations we already store invisible to everyone who does not click. Two
 * `<Link>`s cost no JavaScript and keep the server render authoritative.
 *
 * `availableLocales` is the post's own translation list. Passing it (an
 * article) hides the switch when there is no Bangla to switch to; omitting it
 * (an index or category listing) always shows both, because those pages are
 * translated by their own chrome regardless of which posts underneath them are.
 */
export default function BlogLanguageSwitch({
    path,
    locale,
    availableLocales,
}: {
    path: string;
    locale: BlogLocale;
    availableLocales?: string[];
}) {
    const translated = !availableLocales || availableLocales.includes('bn');
    if (!translated) return null;

    return (
        <nav aria-label={blogStrings(locale).language} className="flex items-center gap-1 text-xs">
            {BLOG_LOCALES.map((code) => {
                const current = code === locale;
                const label = localeRegistry[code].nativeLabel;

                // The language being read is plain text, not a link to itself:
                // a self-link is a dead click and reads as a second option.
                return current ? (
                    <span
                        key={code}
                        aria-current="true"
                        className="rounded-full bg-blue-600 px-2.5 py-1 font-medium text-white"
                    >
                        {label}
                    </span>
                ) : (
                    <Link
                        key={code}
                        href={blogHref(path, code)}
                        hrefLang={code}
                        className="rounded-full border border-gray-200 px-2.5 py-1 font-medium text-gray-600 transition-colors hover:border-blue-600 hover:text-blue-600"
                    >
                        {label}
                    </Link>
                );
            })}
        </nav>
    );
}
