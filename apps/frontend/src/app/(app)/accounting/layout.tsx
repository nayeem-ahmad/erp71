type AccountingLayoutProps = Readonly<{ children: React.ReactNode }>;

/** Accounting routes inherit compact density from the app layout. */
export default function AccountingLayout({ children }: AccountingLayoutProps) {
    return children;
}