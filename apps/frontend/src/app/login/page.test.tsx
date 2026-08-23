import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import LoginPage from './page';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter() {
    return { push: pushMock };
  },
  useSearchParams() {
    return {
      get: jest.fn().mockReturnValue(null),
    };
  },
}));

// Mock API layer
jest.mock('../../lib/api', () => ({
  api: {
    login: jest.fn().mockResolvedValue({
        access_token: 'fake-token',
        tenants: []
    }),
    demoLogin: jest.fn().mockResolvedValue({
        access_token: 'demo-token',
        is_demo: true,
        tenants: [{ id: 'tenant-demo', stores: [{ id: 'store-demo' }] }],
    }),
    getMe: jest.fn().mockResolvedValue({
        tenants: []
    }),
    getSubscriptionPlans: jest.fn(),
    signup: jest.fn(),
    // Google sign-in stays off in these tests; the button renders nothing.
    getGoogleAuthConfig: jest.fn().mockResolvedValue({ enabled: false, client_id: null }),
    googleSignIn: jest.fn(),
  }
}));

describe('Login UI Authentication Mapping', () => {
  it('renders email authentication correctly', () => {
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('updates email and password state', () => {
      render(<LoginPage />);
      const emailInput = screen.getByPlaceholderText(/name@company.com/i);
      const passInput = screen.getByPlaceholderText(/••••••••/i);

      fireEvent.change(emailInput, { target: { value: 'admin@bmad.com' } });
      fireEvent.change(passInput, { target: { value: 'password123' } });

      expect(emailInput).toHaveValue('admin@bmad.com');
      expect(passInput).toHaveValue('password123');
  });

  it('submits the form successfully', async () => {
    const { api } = require('../../lib/api');
    render(<LoginPage />);
    
    fireEvent.change(screen.getByPlaceholderText(/name@company.com/i), { target: { value: 'admin@bmad.com' } });
    fireEvent.change(screen.getByPlaceholderText(/••••••••/i), { target: { value: 'password123' } });
    
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(api.login).toHaveBeenCalledWith({
        email: 'admin@bmad.com',
        password: 'password123'
    });
  });

  it('displays error message on failed login', async () => {
    const { api } = require('../../lib/api');
    api.login.mockRejectedValueOnce(new Error('Invalid credentials'));
    
    render(<LoginPage />);
    
    fireEvent.change(screen.getByPlaceholderText(/name@company.com/i), { target: { value: 'wrong@bmad.com' } });
    fireEvent.change(screen.getByPlaceholderText(/••••••••/i), { target: { value: 'wrong' } });
    
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const errorMsg = await screen.findByText(/Invalid credentials/i);
    expect(errorMsg).toBeInTheDocument();
  });

  it('starts demo sandbox from the demo button', async () => {
    const { api } = require('../../lib/api');

    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /try demo/i }));

    await waitFor(() => {
      expect(api.demoLogin).toHaveBeenCalled();
      expect(localStorage.getItem('demo_session')).toBe('1');
      expect(pushMock).toHaveBeenCalledWith('/dashboard/onboarding');
    });
  });

  it('sets tenant and store in localStorage on successful login', async () => {
    const { api } = require('../../lib/api');
    api.login.mockResolvedValueOnce({ access_token: 't-123' });
    api.getMe.mockResolvedValueOnce({
        tenants: [{
            id: 'tenant-1',
            stores: [{ id: 'store-1' }]
        }]
    });
    
    render(<LoginPage />);
    
    fireEvent.change(screen.getByPlaceholderText(/name@company.com/i), { target: { value: 'admin@bmad.com' } });
    fireEvent.change(screen.getByPlaceholderText(/••••••••/i), { target: { value: 'password123' } });
    
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(localStorage.getItem('tenant_id')).toBe('tenant-1');
    });

    expect(localStorage.getItem('tenant_id')).toBe('tenant-1');
    expect(localStorage.getItem('store_id')).toBe('store-1');
  });

  /**
   * Regression: the login markup is server-rendered, so the form is visible and
   * typable for as long as it takes the bundle to hydrate — measured at ~7s on a
   * cold cache over a slow mobile connection. A click in that window never
   * reaches the React `onSubmit`, so `preventDefault()` never runs and the
   * browser natively submits the (action-less) form: the page reloads and the
   * typed credentials are wiped. Shipping the button disabled closes the gap.
   */
  it('server-renders the submit buttons disabled so a pre-hydration click cannot reload the page', () => {
    const html = renderToString(<LoginPage />);
    const submitButtons = html.match(/<button[^>]*type="submit"[^>]*>/g) ?? [];

    expect(submitButtons.length).toBeGreaterThan(0);
    for (const button of submitButtons) {
      // The `disabled=""` attribute specifically — the className carries
      // Tailwind `disabled:` variants, so a substring check would always pass.
      expect(button).toMatch(/\sdisabled=""/);
    }
  });

  it('enables the submit button once hydrated', async () => {
    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled();
    });
  });
});
