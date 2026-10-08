import { NavLinks } from '@/components/NavLinks';
import { Notice } from '@/components/Notice';
import { logoutAction } from '@/app/login/actions';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const items = [
    can(user, 'overview:read') && { href: '/', label: 'Overview' },
    can(user, 'tenants:read') && { href: '/businesses', label: 'Businesses' },
    can(user, 'review:read') && { href: '/review', label: 'Review' },
    can(user, 'review:read') && { href: '/content', label: 'Topics' },
    can(user, 'runs:read') && { href: '/runs', label: 'Runs' },
    can(user, 'reports:read') && { href: '/usage', label: 'Costs' },
    can(user, 'runs:read') && { href: '/notifications', label: 'Notifications' },
    can(user, 'users:manage') && { href: '/settings', label: 'Settings' },
  ].filter(Boolean) as Array<{ href: string; label: string }>;

  return (
    <>
      <header className="top">
        <div className="wrap">
          <a className="brand" href="/">Control dashboard</a>
          <NavLinks items={items} />
          <form action={logoutAction} className="row">
            <a href="/account" className="small">{user.email}</a>
            <button className="btn secondary" type="submit">Sign out</button>
          </form>
        </div>
      </header>
      <main className="wrap"><Notice />{children}</main>
    </>
  );
}
