'use client';

import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import TenantPostEditor from '@/components/blog/TenantPostEditor';
import { useI18n } from '@/lib/i18n';

export default function NewStorefrontBlogPostPage() {
    const { t } = useI18n();

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader title={t.storefront.blog.newPost} />
                <TenantPostEditor />
            </div>
        </PageShell>
    );
}
