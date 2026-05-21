'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type Locale = 'en' | 'bn';

const translations = {
    en: {
        // Navigation
        nav: {
            dashboard: 'Dashboard',
            pos: 'Point of Sale',
            sales: 'Sales',
            orders: 'Orders',
            quotes: 'Quotations',
            returns: 'Returns',
            purchases: 'Purchases',
            purchaseReturns: 'Purchase Returns',
            inventory: 'Inventory',
            products: 'Products',
            customers: 'Customers',
            suppliers: 'Suppliers',
            accounting: 'Accounting',
            billing: 'Billing',
            settings: 'Settings',
        },
        // Common
        common: {
            save: 'Save',
            cancel: 'Cancel',
            delete: 'Delete',
            edit: 'Edit',
            add: 'Add',
            search: 'Search',
            loading: 'Loading…',
            noData: 'No data found',
            error: 'An error occurred',
            total: 'Total',
            status: 'Status',
            date: 'Date',
            amount: 'Amount',
            actions: 'Actions',
        },
        // Dashboard
        dashboard: {
            welcome: 'Welcome back',
            todaySales: "Today's Sales",
            revenue: 'Revenue',
            expenses: 'Expenses',
            profit: 'Profit',
        },
        // Onboarding
        onboarding: {
            title: 'Get started',
            description: 'Set up your store to start selling',
            cta: 'Start setup',
        },
    },
    bn: {
        // Navigation
        nav: {
            dashboard: 'ড্যাশবোর্ড',
            pos: 'পয়েন্ট অফ সেল',
            sales: 'বিক্রয়',
            orders: 'অর্ডার',
            quotes: 'কোটেশন',
            returns: 'রিটার্ন',
            purchases: 'ক্রয়',
            purchaseReturns: 'ক্রয় রিটার্ন',
            inventory: 'ইনভেন্টরি',
            products: 'পণ্য',
            customers: 'গ্রাহক',
            suppliers: 'সরবরাহকারী',
            accounting: 'হিসাব',
            billing: 'বিলিং',
            settings: 'সেটিংস',
        },
        // Common
        common: {
            save: 'সংরক্ষণ',
            cancel: 'বাতিল',
            delete: 'মুছুন',
            edit: 'সম্পাদনা',
            add: 'যোগ করুন',
            search: 'অনুসন্ধান',
            loading: 'লোড হচ্ছে…',
            noData: 'কোনো তথ্য পাওয়া যায়নি',
            error: 'একটি ত্রুটি ঘটেছে',
            total: 'মোট',
            status: 'অবস্থা',
            date: 'তারিখ',
            amount: 'পরিমাণ',
            actions: 'কার্যক্রম',
        },
        // Dashboard
        dashboard: {
            welcome: 'স্বাগতম',
            todaySales: 'আজকের বিক্রয়',
            revenue: 'আয়',
            expenses: 'ব্যয়',
            profit: 'মুনাফা',
        },
        // Onboarding
        onboarding: {
            title: 'শুরু করুন',
            description: 'বিক্রয় শুরু করতে আপনার স্টোর সেট আপ করুন',
            cta: 'সেটআপ শুরু করুন',
        },
    },
} as const;

export type Translations = {
    nav: Record<string, string>;
    common: Record<string, string>;
    dashboard: Record<string, string>;
    onboarding: Record<string, string>;
};

type I18nContextValue = {
    locale: Locale;
    setLocale: (l: Locale) => void;
    t: Translations;
};

const I18nContext = createContext<I18nContextValue>({
    locale: 'en',
    setLocale: () => undefined,
    t: translations.en,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>('en');

    useEffect(() => {
        const saved = localStorage.getItem('locale') as Locale | null;
        if (saved === 'en' || saved === 'bn') setLocaleState(saved);
    }, []);

    const setLocale = (l: Locale) => {
        setLocaleState(l);
        localStorage.setItem('locale', l);
    };

    return (
        <I18nContext.Provider value={{ locale, setLocale, t: translations[locale] }}>
            {children}
        </I18nContext.Provider>
    );
}

export function useI18n() {
    return useContext(I18nContext);
}
