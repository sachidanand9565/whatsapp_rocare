'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight, Search, UserCog, SlidersHorizontal, X, Check, Eye, EyeOff, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';

interface Agent {
  id: number;
  name: string;
  email: string;
  phone?: string;
  role: 'manager' | 'agent';
  workspace_role: 'manager' | 'agent';
  is_active: number;
  created_at: string;
  plain_password?: string | null;
}

interface Campaign {
  id: number;
  name: string;
  status: string;
  campaign_type: string;
  template_name?: string;
}

const ROLE_BADGE: Record<string, string> = {
  manager: 'bg-blue-100 text-blue-700',
  agent:   'bg-green-100 text-green-700',
};

const STATUS_DOT: Record<string, string> = {
  draft:     'bg-gray-400',
  scheduled: 'bg-blue-400',
  running:   'bg-yellow-400',
  completed: 'bg-green-500',
  failed:    'bg-red-400',
};

// ── Assign Campaigns Modal ────────────────────────────────────
function AssignCampaignsModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [allCampaigns, setAllCampaigns]     = useState<Campaign[]>([]);
  const [assignedIds, setAssignedIds]       = useState<number[]>([]);
  const [loading, setLoading]               = useState(true);
  const [toggling, setToggling]             = useState<number | null>(null);
  const [search, setSearch]                 = useState('');
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';

  useEffect(() => {
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch('/api/campaigns', { headers }).then((r) => r.json()),
      fetch(`/api/agents/${agent.id}/campaigns`, { headers }).then((r) => r.json()),
    ]).then(([allRes, assignedRes]) => {
      setAllCampaigns(allRes.data || []);
      setAssignedIds((assignedRes.data || []).map((c: Campaign) => c.id));
      setLoading(false);
    });
  }, [agent.id, token]);

  async function toggle(campaign: Campaign) {
    const isAssigned = assignedIds.includes(campaign.id);
    setToggling(campaign.id);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/assign`, {
        method: isAssigned ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ agent_id: agent.id }),
      });
      if (res.ok) {
        setAssignedIds((prev) =>
          isAssigned ? prev.filter((id) => id !== campaign.id) : [...prev, campaign.id]
        );
        toast.success(isAssigned ? 'Campaign removed' : 'Campaign assigned!');
      } else {
        toast.error('Failed');
      }
    } finally {
      setToggling(null);
    }
  }

  const filtered = allCampaigns.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Assign Campaigns</h2>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-5 h-5 rounded-full bg-whatsapp-teal text-white text-[10px] font-bold flex items-center justify-center">
                {agent.name.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm text-gray-500">{agent.name}</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${ROLE_BADGE[agent.workspace_role]}`}>
                {agent.workspace_role}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-1">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" placeholder="Search campaigns…"
              value={search} onChange={(e) => setSearch(e.target.value)}
              className="input pl-9 text-sm py-2"
            />
          </div>
        </div>

        {/* Campaign list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loading ? (
            <p className="text-center text-gray-400 py-10 text-sm">Loading campaigns…</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-gray-400 py-10 text-sm">No campaigns found</p>
          ) : (
            filtered.map((campaign) => {
              const isAssigned = assignedIds.includes(campaign.id);
              const isToggling = toggling === campaign.id;
              return (
                <button
                  key={campaign.id}
                  onClick={() => !isToggling && toggle(campaign)}
                  disabled={isToggling}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left
                    ${isAssigned
                      ? 'border-whatsapp-green bg-green-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                    } disabled:opacity-60`}
                >
                  {/* Checkbox */}
                  <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors ${
                    isAssigned ? 'bg-whatsapp-green border-whatsapp-green' : 'border-gray-300'
                  }`}>
                    {isAssigned && <Check size={12} className="text-white" strokeWidth={3} />}
                  </div>

                  {/* Campaign info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{campaign.name}</p>
                    <p className="text-xs text-gray-400 truncate mt-0.5">
                      {campaign.template_name || 'No template'} • {campaign.campaign_type}
                    </p>
                  </div>

                  {/* Status dot */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <div className={`w-2 h-2 rounded-full ${STATUS_DOT[campaign.status] || 'bg-gray-400'}`} />
                    <span className="text-xs text-gray-400 capitalize">{campaign.status}</span>
                  </div>

                  {/* Loading spinner */}
                  {isToggling && (
                    <div className="w-4 h-4 border-2 border-gray-300 border-t-whatsapp-green rounded-full animate-spin flex-shrink-0" />
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {assignedIds.length} campaign{assignedIds.length !== 1 ? 's' : ''} assigned
          </span>
          <button onClick={onClose} className="btn-primary text-sm px-6">Done</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function AgentsPage() {
  const [agents, setAgents]             = useState<Agent[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [showModal, setShowModal]       = useState(false);
  const [assignAgent, setAssignAgent]   = useState<Agent | null>(null);
  const [saving, setSaving]             = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<number, boolean>>({});
  const [changePwdAgent, setChangePwdAgent]     = useState<Agent | null>(null);
  const [newPassword, setNewPassword]           = useState('');
  const [savingPwd, setSavingPwd]               = useState(false);

  const [form, setForm] = useState({
    name: '', email: '', phone: '',
    role: 'agent' as 'manager' | 'agent',
    password: '',
  });

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/agents', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.ok) setAgents(data.data || []);
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  async function createAgent(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to create agent'); return; }
      toast.success('Agent created successfully');
      setShowModal(false);
      setForm({ name: '', email: '', phone: '', role: 'agent', password: '' });
      fetchAgents();
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(agent: Agent) {
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ is_active: agent.is_active ? 0 : 1 }),
    });
    if (res.ok) {
      toast.success(agent.is_active ? 'Agent deactivated' : 'Agent activated');
      fetchAgents();
    }
  }

  async function deleteAgent(agent: Agent) {
    if (!confirm(`Remove ${agent.name} from workspace?`)) return;
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) { toast.success('Agent removed'); fetchAgents(); }
    else toast.error('Failed to remove agent');
  }

  async function changeRole(agent: Agent, role: 'manager' | 'agent') {
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role }),
    });
    if (res.ok) { toast.success('Role updated'); fetchAgents(); }
  }

  async function saveNewPassword() {
    if (!changePwdAgent || !newPassword.trim()) return;
    setSavingPwd(true);
    try {
      const res = await fetch(`/api/agents/${changePwdAgent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: newPassword.trim() }),
      });
      if (!res.ok) { toast.error('Failed to update password'); return; }
      toast.success('Password updated');
      setChangePwdAgent(null);
      setNewPassword('');
      fetchAgents();
    } finally {
      setSavingPwd(false);
    }
  }

  const filtered = agents.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">Agents</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage team members and their access levels</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary flex items-center gap-2 self-start"
        >
          <Plus size={16} /> Add Agent
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text" placeholder="Search by name or email…"
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="input pl-9"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
            <UserCog size={40} className="opacity-30" />
            <p className="text-sm">No agents yet. Add your first agent.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Agent</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Phone</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Password</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Role</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((agent) => (
                  <tr key={agent.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-whatsapp-teal flex items-center justify-center text-white font-semibold text-sm">
                          {agent.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-900">{agent.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{agent.email}</td>
                    <td className="px-4 py-3 text-gray-600">{agent.phone || '—'}</td>
                    <td className="px-4 py-3">
                      {agent.plain_password ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-sm text-gray-700">
                            {visiblePasswords[agent.id] ? agent.plain_password : '••••••••'}
                          </span>
                          <button
                            onClick={() => setVisiblePasswords(p => ({ ...p, [agent.id]: !p[agent.id] }))}
                            className="text-gray-400 hover:text-gray-600 transition-colors">
                            {visiblePasswords[agent.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Not set</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={agent.workspace_role}
                        onChange={(e) => changeRole(agent, e.target.value as 'manager' | 'agent')}
                        className={`text-xs font-semibold px-2 py-1 rounded-full border-0 cursor-pointer ${ROLE_BADGE[agent.workspace_role]}`}
                      >
                        <option value="agent">Agent</option>
                        <option value="manager">Manager</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleStatus(agent)}>
                        {agent.is_active ? (
                          <ToggleRight size={22} className="text-green-500" />
                        ) : (
                          <ToggleLeft size={22} className="text-gray-400" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {/* Change Password */}
                        <button
                          onClick={() => { setChangePwdAgent(agent); setNewPassword(''); }}
                          title="Change password"
                          className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded transition-colors"
                        >
                          <KeyRound size={15} />
                        </button>
                        {/* Assign Campaigns */}
                        <button
                          onClick={() => setAssignAgent(agent)}
                          title="Assign campaigns"
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        >
                          <SlidersHorizontal size={15} />
                        </button>
                        {/* Delete */}
                        <button
                          onClick={() => deleteAgent(agent)}
                          title="Remove agent"
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Agent Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-5">Create Agent</h2>
            <form onSubmit={createAgent} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Agent&apos;s Name</label>
                <input
                  type="text" required placeholder="Full name"
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Agent&apos;s Email</label>
                <input
                  type="email" required placeholder="agent@company.com"
                  value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Number (optional)</label>
                <div className="flex gap-2">
                  <span className="input w-auto px-3 flex items-center text-gray-500 bg-gray-50">+91</span>
                  <input
                    type="tel" placeholder="Agent's WhatsApp Number"
                    value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="input flex-1"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as 'manager' | 'agent' })}
                  className="input"
                >
                  <option value="agent">Agent</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
              <div className="border-t pt-4">
                <p className="text-sm font-medium text-gray-700 mb-3">Login Details</p>
                <input
                  type="password" required placeholder="Password"
                  value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="input"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="flex-1 btn-primary">
                  {saving ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Campaigns Modal */}
      {assignAgent && (
        <AssignCampaignsModal
          agent={assignAgent}
          onClose={() => setAssignAgent(null)}
        />
      )}

      {/* Change Password Modal */}
      {changePwdAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Change Password</h2>
                <p className="text-sm text-gray-500 mt-0.5">{changePwdAgent.name}</p>
              </div>
              <button onClick={() => setChangePwdAgent(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            {changePwdAgent.plain_password && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-xs text-gray-500 mb-1">Current Password</p>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-gray-700 flex-1">
                    {visiblePasswords[changePwdAgent.id] ? changePwdAgent.plain_password : '••••••••'}
                  </span>
                  <button
                    onClick={() => setVisiblePasswords(p => ({ ...p, [changePwdAgent.id]: !p[changePwdAgent.id] }))}
                    className="text-gray-400 hover:text-gray-600">
                    {visiblePasswords[changePwdAgent.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input
                  type="text"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input font-mono"
                  autoFocus
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setChangePwdAgent(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  onClick={saveNewPassword}
                  disabled={savingPwd || !newPassword.trim()}
                  className="flex-1 btn-primary disabled:opacity-50">
                  {savingPwd ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
