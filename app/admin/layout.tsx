'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/hooks/useApi';
import { LayoutDashboard, Building2, Users, ShieldAlert, ArrowLeft, Loader2 } from 'lucide-react';

const NAV = [
  { label: 'Overview',   href: '/admin',            icon: LayoutDashboard },
  { label: 'Workspaces', href: '/admin/workspaces', icon: Building2 },
  { label: 'Users',      href: '/admin/users',      icon: Users },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking');

  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('token')) { router.replace('/login'); return; }
    apiFetch('/api/admin/me')
      .then((r) => setState(r.data?.isSuperAdmin ? 'ok' : 'denied'))
      .catch(() => setState('denied'));
  }, [router]);

  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-4">
        <ShieldAlert size={40} className="text-red-400" />
        <h1 className="text-lg font-bold text-gray-800">Access denied</h1>
        <p className="text-sm text-gray-500">Ye platform super-admin panel hai. Aapke paas access nahi hai.</p>
        <Link href="/dashboard" className="text-sm text-whatsapp-teal font-medium hover:underline mt-2">← Go to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-60 bg-gray-900 text-gray-300 flex flex-col flex-shrink-0">
        <div className="px-5 py-4 border-b border-gray-800">
          <p className="text-white font-bold flex items-center gap-2"><ShieldAlert size={16} className="text-red-400" /> Super Admin</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Platform control panel</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => {
            const active = pathname === n.href;
            return (
              <Link key={n.href} href={n.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${active ? 'bg-red-500/20 text-white' : 'hover:bg-gray-800'}`}>
                <n.icon size={16} /> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-gray-800">
          <Link href="/dashboard" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800">
            <ArrowLeft size={16} /> Back to dashboard
          </Link>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
