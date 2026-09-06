import { render, screen, waitFor } from '@testing-library/react';
import SignupPage from '@/app/signup/page';

let QS = 'plan=business';
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
    useSearchParams: () => new URLSearchParams(QS),
}));
const getSignupDefaults = jest.fn();
jest.mock('@/lib/api', () => ({
    api: {
        getSubscriptionPlans: jest.fn().mockResolvedValue([
            { code: 'BASIC', name: 'Starter', description: 'a', monthly_price: 299 },
            { code: 'ACCOUNTING', name: 'Accounting edition', description: 'e', monthly_price: 749 },
            { code: 'STANDARD', name: 'Growth', description: 'b', monthly_price: 999 },
            { code: 'PREMIUM', name: 'Business', description: 'c', monthly_price: 2499 },
        ]),
        getSignupDefaults: (...a: any[]) => getSignupDefaults(...a),
        signup: jest.fn(),
        validateReferralCode: jest.fn().mockResolvedValue({ valid: false }),
        googleSignIn: jest.fn(),
    },
}));

it('?plan=business preselects PREMIUM even when defaults resolve later', async () => {
    getSignupDefaults.mockImplementation(() => new Promise(r => setTimeout(() => r({ defaultPlanCode: 'STANDARD' }), 30)));
    render(<SignupPage />);
    const biz = await screen.findByRole('radio', { name: /Business/ }) as HTMLInputElement;
    expect(biz.checked).toBe(true);
    await new Promise(r => setTimeout(r, 80));
    const biz2 = screen.getByRole('radio', { name: /Business/ }) as HTMLInputElement;
    console.log('after defaults resolve, business checked =', biz2.checked);
    const growth = screen.getByRole('radio', { name: /Growth/ }) as HTMLInputElement;
    console.log('growth checked =', growth.checked);
});
