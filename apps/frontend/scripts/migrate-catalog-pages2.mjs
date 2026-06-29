#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '../src');

function read(rel) {
    return fs.readFileSync(path.join(SRC, rel), 'utf8');
}
function write(rel, content) {
    fs.writeFileSync(path.join(SRC, rel), content);
    console.log('Updated:', rel);
}

function injectHook(content, hookLine, componentName) {
    if (content.includes('useI18n')) return content;
    if (!content.includes("'use client'")) content = `'use client';\n\n${content}`;
    if (!content.includes("from '@/lib/i18n'")) {
        const idx = content.indexOf('\n', content.startsWith("'use client'") ? 12 : 0);
        content = content.slice(0, idx + 1) + `import { useI18n, formatMessage } from '@/lib/i18n';\n` + content.slice(idx + 1);
    }
    const re = new RegExp(`(export default function ${componentName}\\(\\) \\{)`);
    if (!re.test(content)) {
        const re2 = new RegExp(`(function ${componentName}\\(\\) \\{)`);
        content = content.replace(re2, `$1\n    ${hookLine}`);
    } else {
        content = content.replace(re, `$1\n    ${hookLine}`);
    }
    return content;
}

function replaceAll(content, pairs) {
    let c = content;
    for (const [from, to] of pairs) {
        if (typeof from === 'string') c = c.split(from).join(to);
        else c = c.replace(from, to);
    }
    return c;
}

// Counters
{
    let c = read('app/dashboard/settings/counters/page.tsx');
    c = injectHook(c, 'const { t } = useI18n();\n    const m = t.settingsExtras.counters;', 'CountersPage');
    c = replaceAll(c, [
        ["message: 'Failed to load counters'", 'message: m.loadFailed'],
        ["message: 'Name and counter number are required'", 'message: m.nameRequired'],
        ["message: 'Counter updated'", 'message: m.updated'],
        ["message: 'Counter created'", 'message: m.created'],
        ["err?.message || 'Failed to save counter'", 'err?.message || m.saveFailed'],
        ["confirm('Delete this counter? This cannot be undone.')", 'confirm(m.deleteConfirm)'],
        ["message: 'Counter deleted'", 'message: m.deleted'],
        ["err?.message || 'Failed to delete counter'", 'err?.message || m.deleteFailed'],
        [`message: \`Counter \${newStatus === 'ACTIVE' ? 'activated' : 'deactivated'}\``, `message: newStatus === 'ACTIVE' ? m.activated : m.deactivated`],
        ["err?.message || 'Failed to update counter'", 'err?.message || m.updateFailed'],
        ['No store selected. Please select a store first.', '{m.noStore}'],
        ['>POS Counters<', '>{m.title}<'],
        ['Manage the sales counters for this store. Each cashier session is tied to a counter.', '{m.description}'],
        ['Add Counter', '{m.addCounter}'],
        ['Loading…', '{m.loading}'],
        ['>No counters yet<', '>{m.emptyTitle}<'],
        ['Add counters to allow multiple cashier stations', '{m.emptyDescription}'],
        ['Add First Counter', '{m.addFirstCounter}'],
        ['>#<', '>{m.columns.number}<'],
        ['>Name<', '>{m.columns.name}<'],
        ['>Status<', '>{m.columns.status}<'],
        ["? 'Active' : 'Inactive'", "? m.status.active : m.status.inactive"],
        ["editCounter ? 'Edit Counter' : 'Add Counter'", 'editCounter ? m.modal.editTitle : m.modal.addTitle'],
        ['Counter Name', '{m.modal.nameLabel}'],
        ['placeholder="e.g. Counter 1, Express Lane"', 'placeholder={m.modal.namePlaceholder}'],
        ['Counter Number', '{m.modal.numberLabel}'],
        ['placeholder="1"', 'placeholder={m.modal.numberPlaceholder}'],
        ["{saving ? 'Saving…' : editCounter ? 'Save Changes' : 'Create Counter'}", "{saving ? m.modal.saving : editCounter ? m.modal.saveChanges : m.modal.create}"],
    ]);
    write('app/dashboard/settings/counters/page.tsx', c);
}

// Storefront orders
{
    let c = read('app/dashboard/storefront/page.tsx');
    c = injectHook(c, 'const { t, formatMessage: fmt } = useI18n();\n    const m = t.storefront.dashboard.orders;', 'StorefrontOrdersPage');
    c = replaceAll(c, [
        ["alert(err.message || 'Failed to update status')", 'alert(err.message || m.updateFailed)'],
        ['>Storefront Orders<', '>{m.title}<'],
        ['Online orders from your public store', '{m.description}'],
        ['>Store Settings<', '>{m.storeSettings}<'],
        ['>No orders yet<', '>{m.emptyTitle}<'],
        ['Orders placed on your storefront will appear here.', '{m.emptyDescription}'],
        ['>Order ID<', '>{m.columns.orderId}<'],
        ['>Customer<', '>{m.columns.customer}<'],
        ['>Items<', '>{m.columns.items}<'],
        ['>Total<', '>{m.columns.total}<'],
        ['>Date<', '>{m.columns.date}<'],
        ['>Status<', '>{m.columns.status}<'],
        ['>PENDING<', '>{m.status.pending}<'],
        ['>CONFIRMED<', '>{m.status.confirmed}<'],
        ['>CANCELLED<', '>{m.status.cancelled}<'],
        [
            /Showing \{\(page - 1\) \* 20 \+ 1\}–\{Math\.min\(page \* 20, data\.total\)\} of \{data\.total\} orders/,
            '{fmt(m.pagination, { start: (page - 1) * 20 + 1, end: Math.min(page * 20, data.total), total: data.total })}',
        ],
    ]);
    write('app/dashboard/storefront/page.tsx', c);
}

// Reset password
{
    let c = read('app/reset-password/page.tsx');
    c = injectHook(c, 'const { t } = useI18n();\n    const m = t.auth.resetPassword;', 'ResetPasswordContent');
    c = replaceAll(c, [
        ["setError('Invalid or missing reset token. Please request a new link.')", 'setError(m.missingToken)'],
        ["setError('Passwords do not match.')", 'setError(m.mismatch)'],
        ["setError('Password must be at least 8 characters.')", 'setError(m.tooShort)'],
        ["body?.message || 'Reset failed. The link may have expired.'", 'body?.message || m.defaultError'],
        ['>Password updated<', '>{m.successTitle}<'],
        ['Your password has been changed. Redirecting you to sign in…', '{m.successDescription}'],
        ['>Set new password<', '>{m.title}<'],
        ['Choose a strong password for your account.', '{m.description}'],
        ['Request a new reset link', '{m.requestNewLink}'],
        ['>New password<', '>{m.newPasswordLabel}<'],
        ['placeholder="Min. 8 characters"', 'placeholder={m.newPasswordPlaceholder}'],
        ['>Confirm password<', '>{m.confirmPasswordLabel}<'],
        ['placeholder="Repeat your password"', 'placeholder={m.confirmPasswordPlaceholder}'],
        ['<span>Update password</span>', '<span>{m.submit}</span>'],
        ['Back to sign in', '{m.backToSignIn}'],
    ]);
    write('app/reset-password/page.tsx', c);
}

// Verify email
{
    let c = read('app/verify-email/page.tsx');
    c = injectHook(c, 'const { t, formatMessage: fmt } = useI18n();\n    const m = t.auth.verifyEmail;', 'VerifyEmailContent');
    c = replaceAll(c, [
        ['ERP71', '{m.brand}'],
        ['Verifying your email…', '{m.loadingTitle}'],
        ['This will only take a moment.', '{m.loadingDescription}'],
        ['Check your inbox', '{m.pendingTitle}'],
        ['Email verified!', '{m.successTitle}'],
        ['Your account is now active. You can sign in and start using ERP71.', '{m.successDescription}'],
        ['Verification failed', '{m.errorTitle}'],
        ['Continue to setup', '{m.continueSetup}'],
        ['Back to sign in', '{m.backToSignIn}'],
        ['ERP71 Platform v0.1', '{m.version}'],
    ]);
    write('app/verify-email/page.tsx', c);
}

// Contact
{
    let c = read('app/contact/page.tsx');
    c = injectHook(c, 'const { t } = useI18n();\n    const m = t.marketing.contact;', 'ContactPage');
    c = replaceAll(c, [
        ["setSubject('General Inquiry')", "setSubject(m.subjects[0])"],
        ["setError('All fields are required.')", 'setError(m.validation.required)'],
        ["setError('Please enter a valid email address.')", 'setError(m.validation.invalidEmail)'],
        ["setError('Message must be at least 10 characters.')", 'setError(m.validation.messageTooShort)'],
        ["setError('Unable to send your message. Please check your connection and try again.')", 'setError(m.errors.network)'],
        ["setError(body?.message || 'Something went wrong. Please try again.')", 'setError(body?.message || m.errors.default)'],
        ['>Contact Us<', '>{m.title}<'],
        ["Have a question or need help? We'd love to hear from you.", '{m.description}'],
        ['>Email<', '>{m.info.email}<'],
        ['support@erp71.com', '{m.info.emailValue}'],
        ['>Office<', '>{m.info.address}<'],
        ['Dhaka, Bangladesh', '{m.info.addressValue}'],
        ['>Support hours<', '>{m.info.hours}<'],
        ['Sun–Thu, 9 AM – 6 PM BDT', '{m.info.hoursValue}'],
        ['Your name', '{m.form.name}'],
        ['Email address', '{m.form.email}'],
        ['Subject', '{m.form.subject}'],
        ['Message', '{m.form.message}'],
        ['Send message', '{m.form.submit}'],
        ["submitting ? 'Sending…' : 'Send message'", "submitting ? m.form.submitting : m.form.submit"],
        ['Message sent!', '{m.form.successTitle}'],
        ["Thanks for reaching out. We'll get back to you within 1–2 business days.", '{m.form.successDescription}'],
        ['Send another message', '{m.form.sendAnother}'],
        ["'General Inquiry'", 'm.subjects[0]'],
        ["'Sales'", 'm.subjects[1]'],
        ["'Technical Support'", 'm.subjects[2]'],
        ["'Billing'", 'm.subjects[3]'],
        ["'Partnership'", 'm.subjects[4]'],
    ]);
    write('app/contact/page.tsx', c);
}

// Pricing page chrome
{
    let c = read('app/pricing/page.tsx');
    c = injectHook(c, 'const { t, formatMessage: fmt } = useI18n();\n    const m = t.marketing.pricing;', 'PricingPage');
    c = replaceAll(c, [
        ['>Simple, transparent pricing<', '>{m.title}<'],
        ["Built for Bangladeshi retail businesses. Start free — upgrade when you're ready.", '{m.description}'],
        ['>Monthly<', '>{m.monthly}<'],
        ['>Yearly<', '>{m.yearly}<'],
        ['Compare all plans', '{m.compareTitle}'],
        ['Every feature, every tier — side by side.', '{m.compareDescription}'],
        ['Frequently asked questions', '{m.faqTitle}'],
        ['Ready to get started?', '{m.ctaTitle}'],
        ['Start your 14-day free trial today. No credit card required.', '{m.ctaDescription}'],
        ['Start free trial', '{m.ctaButton}'],
        [/Save \{yearlySavingsPercent\(\)\}%/, '{fmt(m.yearlySave, { percent: yearlySavingsPercent() })}'],
    ]);
    write('app/pricing/page.tsx', c);
}

// Status
{
    let c = read('app/status/page.tsx');
    c = injectHook(c, 'const { t, formatMessage: fmt } = useI18n();\n    const m = t.marketing.status;', 'StatusPage');
    c = replaceAll(c, [
        ["name: 'API'", "name: m.services.api"],
        ["name: 'Database'", "name: m.services.database"],
        ['>System Status<', '>{m.title}<'],
        ['Real-time health of ERP71 services.', '{m.description}'],
        ['All systems operational', '{m.allOperational}'],
        ['Some systems experiencing issues', '{m.someIssues}'],
        ['Major service disruption', '{m.majorOutage}'],
        ['Refresh', '{m.refresh}'],
        ["refreshing ? 'Refreshing…' : 'Refresh'", "refreshing ? m.refreshing : m.refresh"],
        ['Back to home', '{m.backToHome}'],
        ['Operational', '{m.operational}'],
        ['Degraded', '{m.degraded}'],
        ['Down', '{m.down}'],
    ]);
    write('app/status/page.tsx', c);
}

// Legal chrome helper
function migrateLegal(rel, key) {
    let c = read(rel);
    if (c.includes('useI18n')) return;
    c = c.replace(/export const metadata[\s\S]*?};\n\n/, '');
    if (!c.includes("'use client'")) c = `'use client';\n\n${c}`;
    if (!c.includes("from '@/lib/i18n'")) {
        c = c.replace("'use client';\n\n", "'use client';\n\nimport { useI18n } from '@/lib/i18n';\n");
    }
    c = c.replace(/export default function (\w+)\(\) \{/, (match, name) => {
        return `export default function ${name}() {\n    const { t } = useI18n();\n    const m = t.marketing.legal;\n    const p = m.${key};`;
    });
    c = replaceAll(c, [
        ['>ERP71<', '>{m.signIn ? t.marketing.legal.signIn && "ERP71" : "ERP71"}<'],
    ]);
    // Simpler replacements
    c = c.replace(/<Link href="\/" className="text-xl font-black[^>]*>ERP71<\/Link>/,
        '<Link href="/" className="text-xl font-black tracking-tight text-blue-600">ERP71</Link>');
    c = c.replace('>Sign in<', '>{m.signIn}<');
    c = c.replace('>Start free trial<', '>{m.startFreeTrial}<');
    c = c.replace(/<h1[^>]*>[^<]+<\/h1>/, `<h1 className="text-4xl font-black tracking-tight text-gray-900 mb-2">{p.title}</h1>`);
    c = c.replace(/<p className="text-sm text-gray-400 mb-12">[^<]+<\/p>/, '<p className="text-sm text-gray-400 mb-12">{m.lastUpdated}</p>');
    write(rel, c);
}

for (const [rel, key] of [
    ['app/terms/page.tsx', 'terms'],
    ['app/privacy/page.tsx', 'privacy'],
    ['app/refund/page.tsx', 'refund'],
    ['app/sla/page.tsx', 'sla'],
]) {
    migrateLegal(rel, key);
}

console.log('migrate-catalog-pages2 complete');