'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/hooks/useApi';
import { Plus, Trash2, Edit2, X, Check, ShieldCheck, Eye, EyeOff, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface Workspace { id: number; name: string; }
interface SubAdmin {
  id:        number;
  name:      string;
  email:     string;
  is_active: number;
  workspaces: { id: number; name: string; role: string }[];
}

const ROLE_OPTIONS = [
  { value: 'admin',   label: 'Admin',   desc: 'Full access in assigned projects' },
  { value: 'manager', label: 'Manager', desc: 'Can manage chats, campaigns, templates' },
];

export default function SubAdminsPage() {
  const [subAdmins, setSubAdmins]   = useState<SubAdmin[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [editTarget, setEditTarget] = useState<SubAdmin | null>(null);
  const [saving, setSaving]         = useState(false);
  const [showPwd, setShowPwd]       = useState(false);

  const [form, setForm] = useState({
    name: '', email: '', password: '',
    workspace_role: 'admin',
    assigned_workspace_ids: [] as number[],
  });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [saRes, wsRes] = await Promise.all([
        apiFetch('/api/sub-admins'),
        apiFetch('/api/workspaces'),
      ]);
      setSubAdmins(saRes.data || []);
      setWorkspaces(wsRes.data || []);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  }

  function openCreate() {
    setEditTarget(null);
    setForm({ name: '', email: '', password: '', workspace_role: 'admin', assigned_workspace_ids: [] });
    setShowModal(true);
  }

  function openEdit(sa: SubAdmin) {
    setEditTarget(sa);
    setForm({
      name:                   sa.name,
      email:                  sa.email,
      password:               '',
      workspace_role:         sa.workspaces[0]?.role || 'admin',
      assigned_workspace_ids: sa.workspaces.map((w) => w.id),
    });
    setShowModal(true);
  }

  function toggleWorkspace(wsId: number) {
    setForm((prev) => ({
      ...prev,
      assigned_workspace_ids: prev.assigned_workspace_ids.includes(wsId)
        ? prev.assigned_workspace_ids.filter((id) => id !== wsId)
        : [...prev.assigned_workspace_ids, wsId],
    }));
  }

  async function save() {
    if (!form.name || !form.email) { toast.error('Name and email required'); return; }
    if (!editTarget && !form.password) { toast.error('Password required'); return; }
    if (form.assigned_workspace_ids.length === 0) { toast.error('Select at least one project'); return; }
    setSaving(true);
    try {
      if (editTarget) {
        await apiFetch(`/api/sub-admins/${editTarget.id}`, {
          method: 'PATCH',
          body:   JSON.stringify({
            assigned_workspace_ids: form.assigned_workspace_ids,
            workspace_role:         form.workspace_role,
          }),
        });
        toast.success('Sub-admin updated');
      } else {
        await apiFetch('/api/sub-admins', {
          method: 'POST',
          body:   JSON.stringify(form),
        });
        toast.success('Sub-admin created');
      }
      setShowModal(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setSaving(false); }
  }

  async function toggleActive(sa: SubAdmin) {
    try {
      await apiFetch(`/api/sub-admins/${sa.id}`, {
        method: 'PATCH',
        body:   JSON.stringify({ is_active: sa.is_active ? 0 : 1 }),
      });
      setSubAdmins((prev) => prev.map((s) => s.id === sa.id ? { ...s, is_active: sa.is_active ? 0 : 1 } : s));
      toast.success(sa.is_active ? 'Disabled' : 'Enabled');
    } catch { toast.error('Failed'); }
  }

  async function remove(sa: SubAdmin) {
    if (!confirm(`Delete sub-admin "${sa.name}"?`)) return;
    try {
      await apiFetch(`/api/sub-admins/${sa.id}`, { method: 'DELETE' });
      setSubAdmins((prev) => prev.filter((s) => s.id !== sa.id));
      toast.success('Deleted');
    } catch { toast.error('Failed'); }
  }

  const roleBadge = (role: string) =>
    role === 'admin'
      ? 'bg-purple-100 text-purple-700'
      : 'bg-blue-100 text-blue-700';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck size={22} className="text-whatsapp-green" /> Sub Admins
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Create admins with access to specific projects only</p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={15} /> Add Sub Admin
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-gray-300" />
        </div>
      ) : subAdmins.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 py-16 text-center">
          <ShieldCheck size={36} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No sub-admins yet</p>
          <p className="text-xs text-gray-400 mt-1">Add a sub-admin to give limited project access</p>
          <button onClick={openCreate} className="btn-primary mt-4 inline-flex items-center gap-2">
            <Plus size={14} /> Add First Sub Admin
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {subAdmins.map((sa) => (
            <div key={sa.id} className={`bg-white rounded-2xl border p-5 flex items-start gap-4 transition-opacity
              ${sa.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
              {/* Avatar */}
              <div className="w-11 h-11 rounded-full bg-whatsapp-green text-white flex items-center justify-center font-bold text-lg flex-shrink-0">
                {sa.name.charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900">{sa.name}</p>
                  {!sa.is_active && (
                    <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">Disabled</span>
                  )}
                </div>
                <p className="text-sm text-gray-500">{sa.email}</p>

                {/* Assigned projects */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {sa.workspaces.map((w) => (
                    <span key={w.id} className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-lg font-medium">
                      {w.name}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${roleBadge(w.role)}`}>
                        {w.role}
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => toggleActive(sa)} title={sa.is_active ? 'Disable' : 'Enable'}
                  className={`p-2 rounded-lg transition-colors ${sa.is_active ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                  {sa.is_active ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
                <button onClick={() => openEdit(sa)} title="Edit"
                  className="p-2 rounded-lg text-blue-500 hover:bg-blue-50 transition-colors">
                  <Edit2 size={16} />
                </button>
                <button onClick={() => remove(sa)} title="Delete"
                  className="p-2 rounded-lg text-red-400 hover:bg-red-50 transition-colors">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">
                {editTarget ? 'Edit Sub Admin' : 'New Sub Admin'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Name */}
              <div>
                <label className="form-label">Full Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input" placeholder="Rahul Sharma" disabled={!!editTarget} />
              </div>

              {/* Email */}
              <div>
                <label className="form-label">Email *</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="input" placeholder="rahul@company.com" disabled={!!editTarget} />
              </div>

              {/* Password — only on create */}
              {!editTarget && (
                <div>
                  <label className="form-label">Password *</label>
                  <div className="relative">
                    <input type={showPwd ? 'text' : 'password'} value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="input pr-10" placeholder="Min 6 characters" />
                    <button type="button" onClick={() => setShowPwd((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              )}

              {/* Role */}
              <div>
                <label className="form-label">Role in assigned projects</label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLE_OPTIONS.map((opt) => (
                    <button key={opt.value} type="button"
                      onClick={() => setForm({ ...form, workspace_role: opt.value })}
                      className={`p-3 rounded-xl border-2 text-left transition-all
                        ${form.workspace_role === opt.value
                          ? 'border-whatsapp-green bg-green-50'
                          : 'border-gray-200 hover:border-gray-300'}`}>
                      <p className={`text-sm font-semibold ${form.workspace_role === opt.value ? 'text-whatsapp-green' : 'text-gray-800'}`}>
                        {opt.label}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Assign Workspaces */}
              <div>
                <label className="form-label">Assign Projects *</label>
                <div className="space-y-2 max-h-52 overflow-y-auto border border-gray-200 rounded-xl p-2">
                  {workspaces.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-4">No projects found</p>
                  ) : workspaces.map((ws) => {
                    const checked = form.assigned_workspace_ids.includes(ws.id);
                    return (
                      <button key={ws.id} type="button" onClick={() => toggleWorkspace(ws.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left
                          ${checked ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
                        <div className={`w-5 h-5 rounded flex items-center justify-center border-2 flex-shrink-0 transition-colors
                          ${checked ? 'bg-whatsapp-green border-whatsapp-green' : 'border-gray-300'}`}>
                          {checked && <Check size={12} className="text-white" />}
                        </div>
                        <div className="w-7 h-7 rounded-lg bg-whatsapp-teal text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                          {ws.name.charAt(0).toUpperCase()}
                        </div>
                        <span className={`text-sm font-medium ${checked ? 'text-gray-900' : 'text-gray-700'}`}>
                          {ws.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {form.assigned_workspace_ids.length} project{form.assigned_workspace_ids.length !== 1 ? 's' : ''} selected
                </p>
              </div>
            </div>

            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
                {saving ? <Loader2 size={15} className="animate-spin" /> : null}
                {editTarget ? 'Save Changes' : 'Create Sub Admin'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
