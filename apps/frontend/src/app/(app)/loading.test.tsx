import { render, screen } from '@testing-library/react';
import AppLoading from './loading';
import DashboardLoading from './dashboard/loading';
import PosLoading from './sales/pos/loading';

/*
 * The skeletons render with no providers and no props: Next mounts a
 * `loading.tsx` as `<Loading />`, and as the fallback of the boundary inside
 * `(app)/layout.tsx` it must not depend on anything the page itself sets up.
 */
describe('(app) loading skeletons', () => {
    it('draws the default page outline: a list in a PageShell', () => {
        render(<AppLoading />);

        expect(screen.getByRole('status')).toHaveTextContent('Loading...');
        expect(screen.getByTestId('page-skeleton')).toHaveAttribute('data-body', 'table');
    });

    it('draws the dashboard in its own shape', () => {
        render(<DashboardLoading />);

        expect(screen.getByTestId('page-skeleton')).toHaveAttribute('data-body', 'dashboard');
    });

    it('draws the till as product grid and cart, the cart hidden below md where it is a closed sheet', () => {
        const { container } = render(<PosLoading />);

        expect(screen.getByRole('status')).toHaveTextContent('Loading...');
        expect(container.querySelector('.xl\\:grid-cols-5')!.children).toHaveLength(10);
        expect(container.querySelector('.md\\:w-\\[400px\\]')).toHaveClass('hidden', 'md:flex');
    });
});
