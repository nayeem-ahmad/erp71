'use client';

import { useMemo } from 'react';
import {
  Palette, Globe, Receipt, Monitor, ShoppingBag, CreditCard, Tag, Gift,
  Bell, Mail, HandCoins, Sparkles, FileSearch, Database, Store,
} from 'lucide-react';
import CompactLinkGrid from '@/components/ui/compact/CompactLinkGrid';
import PageHeader from '@/components/ui/compact/PageHeader';
import PageShell from '@/components/ui/compact/PageShell';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { isItemVisible } from '@/lib/nav-visibility';
import { isAccountingOnlyBlockedPath } from '@/lib/accounting-only-paths';
import { isAccountingOnlyPlan } from '@/lib/plan-entitlements';

type Card = { href: string; key: string; icon: any; accent: string; entitlement?: string };
type Section = { key: string; cards: Card[] };

const SECTIONS: Section[] = [
  { key: 'businessProfile', cards: [
    { href: routes.settings.branding, key: 'branding', icon: Palette, accent: 'bg-violet-50 text-violet-700 border-violet-100' },
    { href: routes.settings.localization, key: 'localization', icon: Globe, accent: 'bg-sky-50 text-sky-700 border-sky-100' },
    { href: routes.settings.tax, key: 'tax', icon: Receipt, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
    { href: routes.settings.stores, key: 'stores', icon: Store, accent: 'bg-orange-50 text-orange-700 border-orange-100' },
  ]},
  { key: 'salesPos', cards: [
    { href: routes.settings.counters, key: 'counters', icon: Monitor, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
    { href: routes.settings.sales, key: 'sales', icon: ShoppingBag, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    { href: routes.settings.paymentMethods, key: 'paymentMethods', icon: CreditCard, accent: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
    { href: routes.settings.discountCodes, key: 'discountCodes', icon: Tag, accent: 'bg-rose-50 text-rose-700 border-rose-100' },
    { href: routes.settings.loyalty, key: 'loyalty', icon: Gift, accent: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100' },
  ]},
  { key: 'communications', cards: [
    { href: routes.settings.sms, key: 'sms', icon: Bell, accent: 'bg-green-50 text-green-700 border-green-100' },
    { href: routes.settings.reports, key: 'reportEmails', icon: Mail, accent: 'bg-teal-50 text-teal-700 border-teal-100' },
  ]},
  { key: 'billingCredits', cards: [
    { href: '/sms-credits', key: 'smsCredits', icon: HandCoins, accent: 'bg-green-50 text-green-700 border-green-100' },
    { href: '/ai-credits', key: 'aiCredits', icon: Sparkles, accent: 'bg-purple-50 text-purple-700 border-purple-100' },
  ]},
  { key: 'advanced', cards: [
    { href: routes.settings.auditLogs, key: 'auditLogs', icon: FileSearch, accent: 'bg-gray-50 text-gray-700 border-gray-200' },
    { href: routes.settings.data, key: 'data', icon: Database, accent: 'bg-slate-50 text-slate-700 border-slate-200' },
  ]},
];

export default function SettingsHubPage() {
  const { t } = useI18n();
  const { planCode, features, ready } = useTenantPlanFeatures();
  const s = t.settings.hub;
  const accountingOnly = isAccountingOnlyPlan(planCode, features);

  const grids = useMemo(() =>
    SECTIONS.map((section) => ({
      label: s.sections[section.key],
      links: section.cards
        .filter((c) => isItemVisible(c, features) && !(accountingOnly && isAccountingOnlyBlockedPath(c.href)))
        .map((c) => ({ href: c.href, title: s.links[c.key], icon: c.icon, accent: c.accent })),
    })).filter((g) => g.links.length > 0),
  [s, features, accountingOnly]);

  return (
    <PageShell maxWidth="full">
      <PageHeader
        title={s.title}
        subtitle={s.subtitle}
        breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.accountSettings, s.title, 'settings')}
      />
      {ready && grids.map((g) => <CompactLinkGrid key={g.label} label={g.label} links={g.links} />)}
    </PageShell>
  );
}
