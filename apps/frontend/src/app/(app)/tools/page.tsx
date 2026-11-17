import { redirect } from 'next/navigation';
import { routes } from '@/lib/routes';

/** Tools has no hub of its own yet; its one tool is Notes. */
export default function ToolsPage() {
    redirect(routes.tools.notes);
}
