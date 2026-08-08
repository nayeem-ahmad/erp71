'use client';

import { useEffect, useState } from 'react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import ArticleMarkdown from '@/components/blog/ArticleMarkdown';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';

type Update = {
    id: string;
    slug: string;
    title: string;
    excerpt: string | null;
    body_md?: string;
    published_at: string | null;
    reading_minutes: number;
    author_name: string | null;
};

/**
 * The in-app half of the platform blog: release notes and product updates,
 * filtered to the IN_APP audience.
 *
 * Opening the page marks the feed seen. That is the whole read-tracking
 * mechanism — one timestamp on the user, compared against the newest published
 * post. The alternative, a Notification row per user per post, would mean one
 * write for every user of every tenant on the platform each time something is
 * published, and a mistaken publish would mean deleting all of them.
 */
export default function WhatsNewPage() {
    const { t, locale } = useI18n();
    const m = t.marketing.blog;

    const [rows, setRows] = useState<Update[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        api.getBlogUpdates({ locale, limit: 20 })
            .then((data) => {
                if (!cancelled) setRows(data?.rows ?? []);
            })
            .catch((error) => {
                if (!cancelled) toast.error((error as Error).message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        // Marking seen is deliberately not awaited and its failure is ignored:
        // the dot reappearing is a far smaller problem than an error toast on
        // a page the user only came to read.
        void api.markBlogSeen().catch(() => {});

        return () => {
            cancelled = true;
        };
    }, [locale]);

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader title={t.sidebar.items.whatsNew} subtitle={m.subheading} />

                {loading ? (
                    <p className="text-sm text-gray-500">{t.common.loading}</p>
                ) : rows.length === 0 ? (
                    <p className="text-sm text-gray-500">{m.empty}</p>
                ) : (
                    <div className="space-y-4">
                        {rows.map((post) => (
                            <article key={post.id} className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                                <h2 className="text-sm font-semibold text-gray-900">{post.title}</h2>
                                <p className="mt-1 text-xs text-gray-500">
                                    {post.published_at
                                        ? new Date(post.published_at).toLocaleDateString('en-GB', {
                                              day: 'numeric',
                                              month: 'short',
                                              year: 'numeric',
                                          })
                                        : ''}
                                    {post.author_name ? ` · ${post.author_name}` : ''}
                                </p>
                                {post.excerpt && <p className="mt-2 text-sm leading-6 text-gray-700">{post.excerpt}</p>}
                                {post.body_md && (
                                    <div className="mt-2">
                                        <ArticleMarkdown content={post.body_md} />
                                    </div>
                                )}
                            </article>
                        ))}
                    </div>
                )}
            </div>
        </PageShell>
    );
}
