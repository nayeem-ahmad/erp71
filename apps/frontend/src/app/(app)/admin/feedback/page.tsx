import { redirect } from 'next/navigation';

export default function AdminFeedbackPage() {
    redirect('/admin/support?kind=feedback');
}
