'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, MessageSquare, Users, Megaphone,
  FileText, Bot, BarChart3, Settings, LogOut, Menu, X,
  History, CreditCard, UserCog, ChevronRight, Plus, Check, ShieldCheck, GitBranch,
} from 'lucide-react';
import toast from 'react-hot-toast';

type Role = 'admin' | 'manager' | 'agent';

interface Workspace { id: number; name: string; phone_number_id?: string; plan?: string; role?: string; profile_picture_url?: string; }

const ALL_NAV = [
  { label: 'Dashboard',  href: '/dashboard',   icon: LayoutDashboard, roles: ['admin','manager','agent'] },
  { label: 'Inbox',      href: '/inbox',        icon: MessageSquare,   roles: ['admin','manager','agent'] },
  { label: 'History',    href: '/history',      icon: History,         roles: ['admin','manager','agent'] },
  { label: 'Contacts',   href: '/contacts',     icon: Users,           roles: ['admin','manager','agent'] },
  { label: 'Campaigns',  href: '/campaigns',    icon: Megaphone,       roles: ['admin','manager','agent'] },
  { label: 'Templates',  href: '/templates',    icon: FileText,        roles: ['admin','manager'] },
  { label: 'Chatbot',    href: '/chatbot',      icon: Bot,             roles: ['admin'] },
  { label: 'Flows',      href: '/flows',        icon: GitBranch,       roles: ['admin'] },
  { label: 'Analytics',  href: '/analytics',    icon: BarChart3,       roles: ['admin','manager'] },
  { label: 'Agents',     href: '/agents',       icon: UserCog,         roles: ['admin'] },
  { label: 'Sub Admins', href: '/sub-admins',   icon: ShieldCheck,     roles: ['admin'] },
  { label: 'Billing',    href: '/billing',      icon: CreditCard,      roles: ['admin'] },
  { label: 'Settings',   href: '/settings',     icon: Settings,        roles: ['admin'] },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [open, setOpen]         = useState(false);
  const [role, setRole]         = useState<Role>('admin');
  const [userName, setUserName] = useState('');

  // Project switcher state
  const [workspaces, setWorkspaces]         = useState<Workspace[]>([]);
  const [currentWs, setCurrentWs]           = useState<Workspace | null>(null);
  const [showSwitcher, setShowSwitcher]     = useState(false);
  const [showNewModal, setShowNewModal]     = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating]             = useState(false);
  const [switching, setSwitching]           = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      router.replace('/login');
      return;
    }
    const r = (localStorage.getItem('userRole') || 'admin') as Role;
    setRole(r);
    setUserName(localStorage.getItem('userName') || '');

    // Load workspaces from localStorage (set at login)
    const stored = localStorage.getItem('workspaces');
    const wsId   = Number(localStorage.getItem('workspaceId'));
    if (stored) {
      const list: Workspace[] = JSON.parse(stored);
      setWorkspaces(list);
      setCurrentWs(list.find((w) => w.id === wsId) || list[0] || null);
    } else {
      // Fallback: fetch from API
      fetch('/api/workspaces', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
        .then((r) => r.json())
        .then((res) => {
          if (res?.data) {
            setWorkspaces(res.data);
            localStorage.setItem('workspaces', JSON.stringify(res.data));
            setCurrentWs(res.data.find((w: Workspace) => w.id === wsId) || res.data[0] || null);
          }
        });
    }
  }, [router]);

  // Close switcher when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setShowSwitcher(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function switchWorkspace(ws: Workspace) {
    if (ws.id === currentWs?.id || switching) return;
    setSwitching(true);
    try {
      const res  = await fetch('/api/workspace/switch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body:    JSON.stringify({ workspaceId: ws.id }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Switch failed'); return; }
      localStorage.setItem('token', data.data.token);
      localStorage.setItem('workspaceId', String(ws.id));
      localStorage.setItem('userRole', data.data.role);
      setCurrentWs(ws);
      setRole(data.data.role as Role);
      setShowSwitcher(false);
      toast.success(`Switched to ${ws.name}`);
      window.location.href = '/dashboard';
    } finally {
      setSwitching(false);
    }
  }

  async function createProject() {
    if (!newProjectName.trim() || creating) return;
    setCreating(true);
    try {
      const res  = await fetch('/api/workspaces', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body:    JSON.stringify({ name: newProjectName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to create project'); return; }
      const newWs: Workspace = { id: data.data.id, name: data.data.name };
      const updated = [...workspaces, newWs];
      setWorkspaces(updated);
      localStorage.setItem('workspaces', JSON.stringify(updated));
      toast.success(`Project "${newWs.name}" created!`);
      setShowNewModal(false);
      setNewProjectName('');
      // Auto-switch to new project
      switchWorkspace(newWs);
    } finally {
      setCreating(false);
    }
  }

  const nav = ALL_NAV.filter((item) => item.roles.includes(role));

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    localStorage.removeItem('token');
    localStorage.removeItem('workspaceId');
    localStorage.removeItem('userRole');
    localStorage.removeItem('userName');
    localStorage.removeItem('workspaces');
    router.push('/login');
  }

  const roleBadgeColor: Record<Role, string> = {
    admin:   'bg-purple-500',
    manager: 'bg-blue-500',
    agent:   'bg-green-500',
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-16 bg-whatsapp-dark text-white flex flex-col
        transform transition-transform duration-200
        ${open ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:inset-auto
      `}>
        {/* Logo */}
        <div className="flex items-center justify-center py-4 border-b border-white/10">
          <span className="text-xl">💬</span>
          <button className="absolute right-2 lg:hidden" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </div>

        {/* Project Switcher */}
        <div ref={switcherRef} className="relative flex items-center justify-center py-3 border-b border-white/10">
          <button
            onClick={() => setShowSwitcher((v) => !v)}
            title={currentWs?.name || 'Projects'}
            className="flex flex-col items-center gap-1 group"
          >
            <div className="w-8 h-8 rounded-lg bg-whatsapp-teal flex items-center justify-center text-white font-bold text-sm group-hover:opacity-80 transition-opacity overflow-hidden">
              {currentWs?.profile_picture_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={currentWs.profile_picture_url} alt={currentWs.name} className="w-full h-full object-cover" />
              ) : (
                currentWs ? currentWs.name.charAt(0).toUpperCase() : '?'
              )}
            </div>
            <span className="text-[8px] text-white/60 leading-none max-w-[48px] truncate">
              {currentWs?.name || 'Project'}
            </span>
          </button>

          {/* Dropdown panel */}
          {showSwitcher && (
            <div className="absolute left-full ml-2 top-0 z-50 w-56 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden">
              <p className="text-[10px] font-semibold text-gray-400 uppercase px-3 pt-3 pb-1 tracking-wider">Your Projects</p>
              <ul className="max-h-60 overflow-y-auto">
                {workspaces.map((ws) => (
                  <li key={ws.id}>
                    <button
                      onClick={() => switchWorkspace(ws)}
                      disabled={switching}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${ws.id === currentWs?.id ? 'bg-green-50' : ''}`}
                    >
                      <div className="w-7 h-7 rounded-md bg-whatsapp-teal flex items-center justify-center text-white font-bold text-xs flex-shrink-0 overflow-hidden">
                        {ws.profile_picture_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={ws.profile_picture_url} alt={ws.name} className="w-full h-full object-cover" />
                        ) : (
                          ws.name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{ws.name}</p>
                        {ws.plan && <p className="text-[10px] text-gray-400 truncate">{ws.plan}</p>}
                      </div>
                      {ws.id === currentWs?.id && <Check size={14} className="text-whatsapp-teal flex-shrink-0" />}
                      {ws.id !== currentWs?.id && <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-gray-100">
                <button
                  onClick={() => { setShowSwitcher(false); setShowNewModal(true); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-whatsapp-teal font-medium hover:bg-green-50 transition-colors"
                >
                  <Plus size={16} />
                  New Project
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 overflow-y-auto scrollbar-hide" style={{scrollbarWidth:'none'}}>
          {nav.map(({ label, href, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href} href={href}
                onClick={() => setOpen(false)}
                className={`flex flex-col items-center justify-center py-2.5 gap-1 transition-colors
                  ${active ? 'bg-white/10 text-white' : 'text-white/70 hover:text-white hover:bg-white/5'}`}
              >
                <Icon size={18} />
                <span className="text-[9px] font-medium leading-none">{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="flex items-center justify-center py-4 border-t border-white/10">
          <button onClick={logout}
            className="flex flex-col items-center gap-1 text-white/70 hover:text-white transition-colors">
            <LogOut size={18} />
            <span className="text-[9px] font-medium leading-none">Logout</span>
          </button>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setOpen(false)} />
      )}

      {/* New Project Modal */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">New Project</h3>
              <button onClick={() => setShowNewModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Project Name</label>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createProject()}
              placeholder="e.g. RO Care India"
              className="input w-full mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={() => setShowNewModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={createProject} disabled={creating || !newProjectName.trim()} className="btn-primary flex-1">
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-4 lg:px-6 py-3 flex items-center gap-4">
          <button className="lg:hidden text-gray-600 hover:text-gray-900" onClick={() => setOpen(true)}>
            <Menu size={22} />
          </button>
          <h2 className="font-semibold text-gray-800 capitalize flex-1">
            {nav.find((n) => pathname.startsWith(n.href))?.label || 'Dashboard'}
          </h2>
          {userName && (
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-semibold text-white px-2 py-0.5 rounded-full capitalize ${roleBadgeColor[role]}`}>
                {role}
              </span>
              <span className="text-sm text-gray-600 hidden sm:block">{userName}</span>
            </div>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
