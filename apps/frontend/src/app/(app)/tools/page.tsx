import { redirect } from 'next/navigation';
import { routes } from '@/lib/routes';

/** Tools has no hub of its own yet; it opens on Notes. */
export default function ToolsPage() {
    redirect(routes.tools.notes);
}
