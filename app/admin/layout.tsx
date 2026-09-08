'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminFetch } from '@/hooks/useAdminApi';
import { LayoutDashboard, Building2, ShieldAlert, LogOut, Loader2 } from 'lucide-react';
import LogoMark from '../components/LogoMark';

const NAV = [
  { label: 'Overview',   href: '/admin',            icon: LayoutDashboard },
  { label: 'Workspaces', href: '/admin/workspaces', icon: Building2 },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const isLoginPage = pathname === '/admin/login';
  const [state, setState] = useState<'checking' | 'ok'>('checking');

  useEffect(() => {
    if (isLoginPage) return;
    if (typeof window !== 'undefined' && !localStorage.getItem('admin_token')) {
      router.replace('/admin/login');
      return;
    }
    adminFetch('/api/admin/me')
      .then((r) => {
        if (r.data?.isSuperAdmin) setState('ok');
        else { localStorage.removeItem('admin_token'); router.replace('/admin/login'); }
      })
      .catch(() => { localStorage.removeItem('admin_token'); router.replace('/admin/login'); });
  }, [isLoginPage, router]);

  // Login page: render standalone (no sidebar, no guard)
  if (isLoginPage) return <>{children}</>;

  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  function logout() {
    localStorage.removeItem('admin_token');
    router.replace('/admin/login');
  }

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-60 bg-gray-900 text-gray-300 flex flex-col flex-shrink-0">
        <div className="px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2.5 mb-3">
            <LogoMark size="sm" />
            <span className="text-white font-bold tracking-tight">Limbu<span className="text-whatsapp-green">.ai</span></span>
          </div>
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
          <button onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800">
            <LogOut size={16} /> Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
