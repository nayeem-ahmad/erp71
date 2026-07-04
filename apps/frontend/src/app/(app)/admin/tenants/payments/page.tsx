import { redirect } from 'next/navigation';

export default function AdminTenantPaymentsRedirectPage() {
    redirect('/admin/tenants/ledger');
}