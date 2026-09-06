import { render, screen } from '@testing-library/react';
import SignupPage from '@/app/signup/page';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
    useSearchParams: () => new URLSearchParams(''),
}));
jest.mock('@/lib/api', () => ({
    api: {
        getSubscriptionPlans: jest.fn().mockResolvedValue([
            { code: 'BASIC', name: 'Starter', description: 'One counter', monthly_price: 299 },
            { code: 'STANDARD', name: 'Growth', description: 'Growth plan', monthly_price: 999 },
            { code: 'PREMIUM', name: 'Business', description: 'Multi-branch', monthly_price: 2499 },
        ]),
        getSignupDefaults: jest.fn().mockResolvedValue({ defaultPlanCode: 'STANDARD' }),
        signup: jest.fn(),
        validateReferralCode: jest.fn().mockResolvedValue({ valid: false }),
        googleSignIn: jest.fn(),
    },
}));

it('dump ids and links', async () => {
    const { container } = render(<SignupPage />);
    await screen.findByRole('radio', { name: /Business/ });
    const ids = Array.from(container.querySelectorAll('[id]')).map(e => e.id);
    console.log('IDS:', JSON.stringify(ids));
    const dupes = ids.filter((v,i)=>ids.indexOf(v)!==i);
    console.log('DUPES:', JSON.stringify(dupes));
    const links = Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href'));
    console.log('LINKS:', JSON.stringify(links));
    console.log('CHECKBOXES:', container.querySelectorAll('input[type=checkbox]').length);
    const cb = container.querySelector('#signup-terms');
    console.log('CB tag', cb?.tagName, cb?.getAttribute('type'));
});
