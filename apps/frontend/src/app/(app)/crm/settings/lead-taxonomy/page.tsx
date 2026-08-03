import { redirect } from 'next/navigation';
import { routes } from '@/lib/routes';

/**
 * Folded into CRM Setup. Kept as a redirect rather than deleted because this URL
 * was linked from the CRM hub and may be bookmarked.
 */
export default function LeadTaxonomySettingsRedirect() {
    redirect(`${routes.crm.setup}?tab=sources`);
}
