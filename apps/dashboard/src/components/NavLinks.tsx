'use client';
import { usePathname } from 'next/navigation';

export function NavLinks({ items }: { items: Array<{ href: string; label: string }> }) {
  const path = usePathname();
  return (
    <nav aria-label="Main">
      {items.map((i) => {
        const active = i.href === '/' ? path === '/' : path.startsWith(i.href);
        return (
          <a key={i.href} href={i.href} aria-current={active ? 'page' : undefined}>
            {i.label}
          </a>
        );
      })}
    </nav>
  );
}
