import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldHalf, Plus, Pencil, Trash2, Users, Search, Download, ShieldOff, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { getAuth } from '@/lib/auth';
import PageHeader, { PageShell, LoadingBlock, EmptyBlock, ErrorBlock } from '../components/PageHeader';
import { errorMessage, fmtDateTime } from '../lib';

const BASE_ROLES = ['employee', 'manager', 'admin'];
const EMPTY_ROLE = { name: '', description: '', base_role: 'employee', permissions: [] };

const RoleDialog = ({ open, role, catalog, onClose, onSaved }) => {
  const [form, setForm] = useState(EMPTY_ROLE);
  const [saving, setSaving] = useState(false);
  const [lastKey, setLastKey] = useState(null);

  // Reset the form whenever a different role (or a new one) is opened
  const key = open ? role?.id || 'new' : null;
  if (key !== lastKey) {
    setLastKey(key);
    setForm(role ? { name: role.name, description: role.description || '', base_role: role.base_role, permissions: role.permissions || [] } : EMPTY_ROLE);
  }

  const groups = useMemo(() => {
    const g = {};
    for (const p of catalog?.permissions || []) (g[p.group] = g[p.group] || []).push(p);
    return Object.entries(g);
  }, [catalog]);
  const defaults = catalog?.role_defaults?.[form.base_role] || [];

  const toggle = (key2, on) => setForm(f => ({ ...f, permissions: on ? [...new Set([...f.permissions, key2])] : f.permissions.filter(p => p !== key2) }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...form, description: form.description || null };
      if (role) await api.put(`/v2/platform/roles/${role.id}`, body);
      else await api.post('/v2/platform/roles', body);
      toast.success(role ? 'Role updated' : 'Role created');
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save the role'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle>{role ? 'Edit role' : 'New role'}</DialogTitle>
            <DialogDescription>
              The base role decides which existing screens the person can use; permissions add access on top of it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="role-name">Name</Label>
              <Input id="role-name" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" placeholder="e.g. Payroll Officer" />
            </div>
            <div>
              <Label htmlFor="role-desc">Description</Label>
              <Textarea id="role-desc" rows={2} maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>Base role</Label>
              <div className="flex gap-2 mt-1">
                {BASE_ROLES.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setForm({ ...form, base_role: r })}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm capitalize ${form.base_role === r ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700 hover:border-slate-400'}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {form.base_role === 'admin' && <p className="text-xs text-amber-700 mt-1">Admins already have every permission.</p>}
            </div>
            <div className="space-y-3">
              <Label>Permissions</Label>
              {groups.map(([group, perms]) => (
                <div key={group}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{group}</p>
                  <div className="grid sm:grid-cols-2 gap-1.5">
                    {perms.map(p => {
                      const inherited = form.base_role === 'admin' || defaults.includes(p.key);
                      return (
                        <label key={p.key} className="flex items-center gap-2 text-sm text-slate-700">
                          <Checkbox
                            checked={inherited || form.permissions.includes(p.key)}
                            disabled={inherited}
                            onCheckedChange={(v) => toggle(p.key, !!v)}
                          />
                          <span>{p.label}</span>
                          {inherited && <span className="text-[10px] text-slate-400">(base role)</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || form.name.trim().length < 2}>{saving ? 'Saving…' : 'Save role'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const RolesPage = () => {
  const { user: me } = getAuth();
  const [catalog, setCatalog] = useState(null);
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState({ open: false, role: null });
  const [search, setSearch] = useState('');
  const [busyUser, setBusyUser] = useState(null);
  const [confirmReset, setConfirmReset] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, r, u] = await Promise.all([
        api.get('/v2/platform/permissions'),
        api.get('/v2/platform/roles'),
        api.get('/v2/platform/security/users'),
      ]);
      setCatalog(c.data);
      setRoles(r.data);
      setUsers(u.data);
    } catch (e) {
      setError(errorMessage(e, 'Could not load roles'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const permLabel = (key) => catalog?.permissions?.find(p => p.key === key)?.label || key;

  const removeRole = async (role) => {
    try {
      await api.delete(`/v2/platform/roles/${role.id}`);
      toast.success('Role deleted');
      load();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not delete the role'));
    }
  };

  const assign = async (u, value) => {
    setBusyUser(u.id);
    try {
      const body = value.startsWith('custom:') ? { user_id: u.id, role_id: value.slice(7) } : { user_id: u.id, role_id: null, role: value };
      const r = await api.put('/v2/platform/roles-assign', body);
      setUsers(list => list.map(x => (x.id === u.id ? { ...x, role: r.data.role, custom_role_id: r.data.custom_role_id, custom_role_name: r.data.custom_role_name } : x)));
      toast.success(`Updated ${u.full_name}`);
      api.get('/v2/platform/roles').then(res => setRoles(res.data)).catch(() => {});
    } catch (e) {
      toast.error(errorMessage(e, 'Could not change the role'));
    } finally {
      setBusyUser(null);
    }
  };

  const reset2fa = async (u) => {
    try {
      await api.delete(`/v2/platform/2fa/users/${u.id}`);
      setUsers(list => list.map(x => (x.id === u.id ? { ...x, two_factor_enabled: false } : x)));
      toast.success(`Two-factor authentication reset for ${u.full_name}`);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not reset 2FA'));
    } finally {
      setConfirmReset(null);
    }
  };

  const filteredUsers = users.filter(u => !search || `${u.full_name} ${u.email} ${u.employee_id || ''}`.toLowerCase().includes(search.toLowerCase()));

  const exportUsers = () => exportCsv('user-roles', filteredUsers, [
    { key: 'full_name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'employee_id', label: 'Employee ID' },
    { key: 'role', label: 'Base role' },
    { key: 'custom_role_name', label: 'Custom role' },
    { label: '2FA', value: r => (r.two_factor_enabled ? 'On' : 'Off') },
    { label: 'Active', value: r => (r.is_active ? 'Yes' : 'No') },
    { key: 'last_login_at', label: 'Last sign-in' },
  ]);

  return (
    <PageShell>
      <PageHeader icon={ShieldHalf} title="Roles & Permissions" subtitle="Custom roles, fine-grained permissions and who has them">
        <Button onClick={() => setDialog({ open: true, role: null })} className="gap-2 w-full sm:w-auto">
          <Plus className="w-4 h-4" /> New role
        </Button>
      </PageHeader>

      {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={load} /> : (
        <Tabs defaultValue="roles">
          <TabsList>
            <TabsTrigger value="roles">Roles ({roles.length})</TabsTrigger>
            <TabsTrigger value="users">People ({users.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="roles" className="mt-4 space-y-3">
            {roles.length === 0 ? (
              <Card className="border-0 shadow-md"><CardContent className="p-0">
                <EmptyBlock icon={ShieldHalf} title="No custom roles yet">
                  Everyone uses the built-in Admin, Manager and Employee roles. Create a role (e.g. "Payroll Officer") to grant extra permissions.
                </EmptyBlock>
              </CardContent></Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {roles.map(role => (
                  <Card key={role.id} className="border-0 shadow-md">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-base flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate">{role.name}</span>
                          <span className="text-xs font-normal text-slate-500">Base: <span className="capitalize">{role.base_role}</span> · {role.member_count} member{role.member_count === 1 ? '' : 's'}</span>
                        </span>
                        <span className="flex gap-1 shrink-0">
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit role" onClick={() => setDialog({ open: true, role })}><Pencil className="w-4 h-4" /></Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" aria-label="Delete role" disabled={role.member_count > 0} title={role.member_count > 0 ? 'Reassign members first' : 'Delete role'} onClick={() => removeRole(role)}><Trash2 className="w-4 h-4" /></Button>
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      {role.description && <p className="text-xs text-slate-600 mb-2">{role.description}</p>}
                      <div className="flex flex-wrap gap-1">
                        {(role.permissions || []).length === 0
                          ? <span className="text-xs text-slate-400">Base role permissions only</span>
                          : role.permissions.map(p => <Badge key={p} variant="outline" className="text-[11px]">{permLabel(p)}</Badge>)}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            <Card className="border-0 shadow-sm bg-slate-50">
              <CardContent className="p-4 text-xs text-slate-600 space-y-1">
                <p className="font-medium text-slate-800">Built-in defaults</p>
                {['manager', 'employee'].map(r => (
                  <p key={r}><span className="capitalize font-medium">{r}:</span> {(catalog?.role_defaults?.[r] || []).map(permLabel).join(', ') || 'no extra permissions'}</p>
                ))}
                <p><span className="font-medium">Admin:</span> every permission</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users" className="mt-4">
            <Card className="border-0 shadow-md">
              <CardHeader className="border-b border-slate-100 p-3 sm:p-4">
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4 text-slate-600" /> People</CardTitle>
                  <div className="flex gap-2">
                    <div className="relative flex-1 sm:w-64">
                      <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email" className="pl-8 h-9" />
                    </div>
                    <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={exportUsers} disabled={!filteredUsers.length}>
                      <Download className="w-4 h-4" /> <span className="hidden sm:inline">Export CSV</span>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {filteredUsers.length === 0 ? <EmptyBlock icon={Users} title="No people match your search" /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                        <tr>
                          <th className="text-left font-medium px-4 py-3">Person</th>
                          <th className="text-left font-medium px-4 py-3">Role</th>
                          <th className="text-left font-medium px-4 py-3 hidden md:table-cell">2FA</th>
                          <th className="text-left font-medium px-4 py-3 hidden lg:table-cell">Last sign-in</th>
                          <th className="px-4 py-3"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredUsers.map(u => {
                          const value = u.custom_role_id ? `custom:${u.custom_role_id}` : u.role;
                          const self = u.email === me?.email;
                          return (
                            <tr key={u.id || u.email} className="hover:bg-slate-50">
                              <td className="px-4 py-3">
                                <p className="font-medium text-slate-900 truncate max-w-[220px]">{u.full_name}</p>
                                <p className="text-xs text-slate-500 truncate max-w-[220px]">{u.email}</p>
                                {!u.is_active && <Badge className="bg-red-100 text-red-700 hover:bg-red-100 text-[10px] mt-0.5">Deactivated</Badge>}
                              </td>
                              <td className="px-4 py-3">
                                <select
                                  value={value}
                                  disabled={self || busyUser === u.id}
                                  onChange={(e) => assign(u, e.target.value)}
                                  className="w-full max-w-[200px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
                                  aria-label={`Role for ${u.full_name}`}
                                  title={self ? "You can't change your own role" : undefined}
                                >
                                  <optgroup label="Built-in">
                                    {BASE_ROLES.map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
                                  </optgroup>
                                  {roles.length > 0 && (
                                    <optgroup label="Custom">
                                      {roles.map(r => <option key={r.id} value={`custom:${r.id}`}>{r.name} ({r.base_role})</option>)}
                                    </optgroup>
                                  )}
                                </select>
                              </td>
                              <td className="px-4 py-3 hidden md:table-cell">
                                {u.two_factor_enabled
                                  ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">On</Badge>
                                  : <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">Off</Badge>}
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-500 hidden lg:table-cell whitespace-nowrap">
                                {fmtDateTime(u.last_login_at)}{u.last_login_method && u.last_login_method !== 'password' ? ` · ${u.last_login_method}` : ''}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {u.two_factor_enabled && !self && (
                                  <Button variant="ghost" size="sm" className="text-xs gap-1 text-red-600 hover:text-red-700" onClick={() => setConfirmReset(u)}>
                                    <ShieldOff className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Reset 2FA</span>
                                  </Button>
                                )}
                                {self && <span className="text-[11px] text-slate-400 inline-flex items-center gap-1"><UserCog className="w-3.5 h-3.5" /> You</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <RoleDialog
        open={dialog.open}
        role={dialog.role}
        catalog={catalog}
        onClose={() => setDialog({ open: false, role: null })}
        onSaved={() => { setDialog({ open: false, role: null }); load(); }}
      />

      <Dialog open={!!confirmReset} onOpenChange={(o) => !o && setConfirmReset(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset two-factor authentication?</DialogTitle>
            <DialogDescription>
              {confirmReset?.full_name} will sign in with just their password until they set up 2FA again. Use this when someone has lost their phone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={() => reset2fa(confirmReset)}>Reset 2FA</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default RolesPage;
