'use client';

import { use } from 'react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import TenantPostEditor from '@/components/blog/TenantPostEditor';
import { useI18n } from '@/lib/i18n';

export default function EditStorefrontBlogPostPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { t } = useI18n();

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader title={t.storefront.blog.title} />
                <TenantPostEditor postId={id} />
            </div>
        </PageShell>
    );
}
