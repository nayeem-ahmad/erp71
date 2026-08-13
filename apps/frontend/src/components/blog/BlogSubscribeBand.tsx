import Link from 'next/link';

/**
 * The conversion band that closes the blog index.
 *
 * The design this borrows from puts an email capture here. ERP71 has no
 * subscriber list and no subscribe endpoint, so a form would collect addresses
 * and drop them — worse than no form. The two things a reader can actually do
 * today take its place: follow the feed, or start a trial. Swap the RSS link
 * for a real form the day there is something behind it.
 */
export default function BlogSubscribeBand() {
    const action =
        'inline-flex min-h-touch w-full items-center justify-center rounded-xl px-6 py-3 text-sm transition-colors sm:w-auto';

    return (
        <section className="mt-16 rounded-2xl bg-blue-600 px-6 py-12 text-center md:px-12 md:py-16">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-100">Written for shopkeepers</p>

            <h2 className="mx-auto mt-4 max-w-2xl text-2xl font-bold leading-snug text-white md:text-3xl">
                Stock, cash, staff and the software in between — new posts as we publish them.
            </h2>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href="/blog/rss.xml" className={`${action} bg-white font-bold text-blue-600 hover:bg-blue-50`}>
                    Subscribe via RSS
                </Link>
                <Link
                    href="/signup"
                    className={`${action} border border-white/40 font-semibold text-white hover:bg-white/10`}
                >
                    Start free trial
                </Link>
            </div>
        </section>
    );
}
