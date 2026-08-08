'use client';

import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import AdminPostEditor from '@/components/blog/AdminPostEditor';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

export default function NewAdminBlogPostPage() {
    const { t } = useI18n();
    const m = t.admin.blog;

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader
                    title={m.editor.newTitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        m.title,
                        'admin',
                    )}
                />
                <AdminPostEditor />
            </div>
        </PageShell>
    );
}
