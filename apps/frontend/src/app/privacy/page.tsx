export const metadata = {
    title: 'Privacy Policy — RetailSaaS',
    description: 'Privacy policy and data handling practices for RetailSaaS',
};

export default function PrivacyPage() {
    return (
        <main className="max-w-3xl mx-auto px-6 py-16 prose prose-slate">
            <h1>Privacy Policy</h1>
            <p className="text-sm text-gray-500">Last updated: May 2026</p>

            <h2>1. What We Collect</h2>
            <p>
                We collect information you provide directly: name, email address, business name, and store
                details. We also collect usage data (pages visited, features used) to improve the service.
            </p>

            <h2>2. How We Use Your Data</h2>
            <ul>
                <li>To provide and operate the RetailSaaS platform</li>
                <li>To send transactional emails (invoices, alerts, invitations)</li>
                <li>To detect and prevent fraud or abuse</li>
                <li>To comply with legal obligations</li>
            </ul>

            <h2>3. Data Sharing</h2>
            <p>
                We do not sell your personal data. We share data only with service providers (hosting,
                email delivery, error monitoring) who process it on our behalf under strict agreements.
            </p>

            <h2>4. Data Retention</h2>
            <ul>
                <li>Account data: retained while your account is active and for 30 days after deletion</li>
                <li>Transaction records: retained for 7 years for accounting compliance</li>
                <li>Audit logs: retained for 90 days</li>
                <li>Security tokens (password reset, invitations): purged after 7 days</li>
            </ul>

            <h2>5. Your Rights</h2>
            <p>Under GDPR/PDPA you have the right to:</p>
            <ul>
                <li><strong>Access</strong> — export a copy of your personal data from your account settings</li>
                <li><strong>Correction</strong> — update your profile at any time</li>
                <li><strong>Deletion</strong> — request account deletion from your account settings</li>
                <li><strong>Portability</strong> — download your data in JSON format</li>
            </ul>
            <p>
                To exercise these rights, use the <strong>Account Settings → Data &amp; Privacy</strong>{' '}
                section, or contact us at{' '}
                <a href="mailto:privacy@retailsaas.com">privacy@retailsaas.com</a>.
            </p>

            <h2>6. Cookies</h2>
            <p>
                We use only essential session cookies required for authentication. We do not use tracking
                or advertising cookies.
            </p>

            <h2>7. Security</h2>
            <p>
                All data is transmitted over TLS. Passwords are hashed with bcrypt. Sensitive tokens are
                stored as SHA-256 hashes. We employ rate limiting, audit logging, and access controls.
            </p>

            <h2>8. Contact</h2>
            <p>
                Data Controller: RetailSaaS Ltd.<br />
                Email: <a href="mailto:privacy@retailsaas.com">privacy@retailsaas.com</a>
            </p>
        </main>
    );
}
