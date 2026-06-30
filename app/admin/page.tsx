'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/hooks/useApi';
import { Building2, Users, MessageSquare, Megaphone, UserPlus, Loader2 } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Stats {
  totals: { workspaces?: number; active_workspaces?: number; users?: number; active_users?: number; contacts?: number; campaigns?: number; messages_sent?: number };
  byPlan: Record<string, number>;
  messages7d: { date: string; count: number }[];
  recentWorkspaces: { id: number; name: string; plan: string; is_active: number; owner_name: string; created_at: string }[];
}

export default function AdminOverview() {
  const [s, setS]         = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/admin/stats').then((r) => setS(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-10 flex justify-center text-gray-400"><Loader2 className="animate-spin" /></div>;
  if (!s) return <div className="p-10 text-gray-500">Failed to load stats.</div>;

  const t = s.totals;
  const cards = [
    { label: 'Workspaces', value: t.workspaces ?? 0,   sub: `${t.active_workspaces ?? 0} active`, icon: Building2,     color: 'text-blue-600 bg-blue-50' },
    { label: 'Users',      value: t.users ?? 0,        sub: `${t.active_users ?? 0} active`,      icon: Users,         color: 'text-purple-600 bg-purple-50' },
    { label: 'Contacts',   value: t.contacts ?? 0,     sub: 'across platform',                    icon: UserPlus,      color: 'text-green-600 bg-green-50' },
    { label: 'Campaigns',  value: t.campaigns ?? 0,    sub: 'total',                              icon: Megaphone,     color: 'text-orange-600 bg-orange-50' },
    { label: 'Messages',   value: t.messages_sent ?? 0, sub: 'sent (outbound)',                   icon: MessageSquare, color: 'text-teal-600 bg-teal-50' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Platform Overview</h1>
        <p className="text-sm text-gray-500">Saare accounts ka summary.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2 ${c.color}`}><c.icon size={18} /></div>
            <p className="text-2xl font-bold text-gray-900">{Number(c.value).toLocaleString('en-IN')}</p>
            <p className="text-xs font-medium text-gray-600">{c.label}</p>
            <p className="text-[11px] text-gray-400">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Messages chart */}
        <div className="md:col-span-2 bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-700 mb-3">Messages sent (last 7 days)</p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={s.messages7d}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Area type="monotone" dataKey="count" stroke="#0d9488" fill="#0d948822" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Plans breakdown */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-700 mb-3">Plans</p>
          <div className="space-y-2">
            {(['free', 'pro', 'enterprise'] as const).map((p) => (
              <div key={p} className="flex items-center justify-between text-sm">
                <span className="capitalize text-gray-600">{p}</span>
                <span className="font-bold text-gray-900">{s.byPlan[p] ?? 0}</span>
              </div>
            ))}
          </div>
          <Link href="/admin/workspaces" className="text-xs text-whatsapp-teal font-medium hover:underline mt-3 inline-block">Manage workspaces →</Link>
        </div>
      </div>

      {/* Recent workspaces */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
        <p className="text-sm font-semibold text-gray-700 mb-3">Recent signups</p>
        <div className="divide-y divide-gray-50">
          {s.recentWorkspaces.map((w) => (
            <div key={w.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <p className="font-medium text-gray-800">{w.name}</p>
                <p className="text-xs text-gray-400">{w.owner_name}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{w.plan}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${w.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                  {w.is_active ? 'Active' : 'Suspended'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
