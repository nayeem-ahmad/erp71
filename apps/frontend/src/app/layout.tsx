import type { Metadata } from 'next';
import './globals.css';
import { I18nProvider } from '../lib/i18n';

export const metadata: Metadata = {
    title: 'RetailSaaS — Retail management for Bangladeshi businesses',
    description: 'All-in-one retail management platform with POS, inventory, sales analytics, and integrated BDT payments.',
    manifest: '/manifest.json',
    themeColor: '#2563eb',
    appleWebApp: {
        capable: true,
        statusBarStyle: 'default',
        title: 'RetailSaaS',
    },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>
                <I18nProvider>{children}</I18nProvider>
            </body>
        </html>
    );
}
