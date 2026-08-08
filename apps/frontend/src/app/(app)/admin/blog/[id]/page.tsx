'use client';

import { use } from 'react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import AdminPostEditor from '@/components/blog/AdminPostEditor';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

export default function EditAdminBlogPostPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { t } = useI18n();
    const m = t.admin.blog;

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader
                    title={m.editor.editTitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        m.title,
                        'admin',
                    )}
                />
                <AdminPostEditor postId={id} />
            </div>
        </PageShell>
    );
}
