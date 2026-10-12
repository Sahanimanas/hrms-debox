import React, { useState, useEffect, useCallback } from 'react';
import { Fingerprint, Plus, KeyRound, Copy, Power, Trash2, Search, Save, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';

const API_BASE = import.meta.env.VITE_APP_BACKEND_URL
  ? `${import.meta.env.VITE_APP_BACKEND_URL}/api`
  : `${window.location.origin}/api`;

const KeyDialog = ({ apiKey, onClose }) => (
  <Dialog open={!!apiKey} onOpenChange={(o) => !o && onClose()}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Device API key</DialogTitle></DialogHeader>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Copy this key into the device or its sync software now. <b>It won't be shown again.</b></p>
        <div className="flex gap-2">
          <Input readOnly value={apiKey || ''} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button variant="outline" size="icon" aria-label="Copy key" onClick={() => navigator.clipboard?.writeText(apiKey).then(() => toast.success('Copied'))}>
            <Copy className="w-4 h-4" />
          </Button>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-1">
          <p className="font-medium text-slate-800">How the device sends punches</p>
          <p className="font-mono break-all">POST {API_BASE}/time/devices/punches</p>
          <p className="font-mono">Header: X-Device-Key: &lt;key&gt;</p>
          <p className="font-mono break-all">{'{ "punches": [{ "device_user_id": "101", "timestamp": "2026-10-10T09:28:00+05:30" }] }'}</p>
          <p>The earliest punch of the day becomes the clock-in and the latest the clock-out. Re-sending the same punches is safe.</p>
        </div>
      </div>
      <DialogFooter><Button onClick={onClose} className="bg-slate-800 hover:bg-slate-900">Done</Button></DialogFooter>
    </DialogContent>
  </Dialog>
);

const DevicesPage = () => {
  const [devices, setDevices] = useState([]);
  const [mapping, setMapping] = useState([]);
  const [edits, setEdits] = useState({});
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', location: '', type: 'biometric' });
  const [revealedKey, setRevealedKey] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    let active = true;
    Promise.all([api.get('/time/devices'), api.get('/time/devices/user-map')])
      .then((res) => {
        if (!active) return;
        const [d, m] = res;
        setDevices(d.data || []);
        setMapping(m.data || []);
        setEdits({});
      })
      .catch((error) => toast.error(error.response?.data?.detail || 'Failed to load devices'));
    return () => { active = false; };
  }, [reloadKey]);

  const create = async () => {
    try {
      const res = await api.post('/time/devices', form);
      setShowNew(false);
      setForm({ name: '', location: '', type: 'biometric' });
      setRevealedKey(res.data.api_key);
      load();
    } catch (error) {
      toast.error(error.response?.data?.errors?.[0]?.message || error.response?.data?.detail || 'Failed to add device');
    }
  };

  const rotate = async (device) => {
    try {
      const res = await api.post(`/time/devices/${device.id}/rotate-key`);
      setRevealedKey(res.data.api_key);
      load();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to rotate key');
    }
  };

  const toggle = async (device) => {
    try {
      await api.put(`/time/devices/${device.id}`, { is_active: !device.is_active });
      load();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update device');
    }
  };

  const remove = async (device) => {
    if (confirmDelete !== device.id) {
      setConfirmDelete(device.id);
      setTimeout(() => setConfirmDelete(c => (c === device.id ? null : c)), 4000);
      return;
    }
    try {
      await api.delete(`/time/devices/${device.id}`);
      toast.success('Device removed');
      load();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to remove device');
    }
  };

  const saveMapping = async () => {
    const mappings = Object.entries(edits).map(([employee_id, device_user_id]) => ({ employee_id, device_user_id: device_user_id.trim() }));
    if (!mappings.length) return;
    try {
      const res = await api.put('/time/devices/user-map', { mappings });
      if (res.data.errors?.length) toast.warning(res.data.errors.map(e => e.reason).join('; '));
      else toast.success(`Saved ${res.data.updated} device ID(s)`);
      load();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.response?.data?.errors?.[0]?.reason || 'Failed to save device IDs');
    }
  };

  const visible = mapping.filter(e => {
    const q = search.trim().toLowerCase();
    return !q || [e.full_name, e.email, e.department, e.employee_id, e.device_user_id].some(v => v?.toLowerCase().includes(q));
  });
  const pending = Object.keys(edits).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-3 sm:p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-2 sm:p-3 bg-slate-800 rounded-lg sm:rounded-xl shadow-lg">
              <Fingerprint className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>Attendance Devices</h1>
              <p className="text-xs sm:text-sm text-slate-600">Biometric and RFID machines that send punches automatically</p>
            </div>
          </div>
          <Button onClick={() => setShowNew(true)} className="bg-slate-800 hover:bg-slate-900 gap-2 w-full sm:w-auto"><Plus className="w-4 h-4" /> Add device</Button>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {devices.map(d => (
            <Card key={d.id} className="border-slate-100 shadow-sm">
              <CardContent className="p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{d.name}</p>
                    <p className="text-xs text-slate-500">{d.location || 'No location'} · <span className="capitalize">{d.type}</span></p>
                  </div>
                  <Badge className={d.is_active ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-100'}>
                    {d.is_active ? 'Active' : 'Disabled'}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-y-1 text-xs">
                  <dt className="text-slate-500">Key</dt><dd className="font-mono text-slate-900">{d.key_prefix}…</dd>
                  <dt className="text-slate-500">Last seen</dt><dd className="text-slate-900">{d.last_seen_at ? formatDistanceToNow(new Date(d.last_seen_at), { addSuffix: true }) : 'Never'}</dd>
                  <dt className="text-slate-500">Punches</dt><dd className="text-slate-900">{d.punch_count || 0}</dd>
                </dl>
                <div className="flex flex-wrap gap-1 pt-2 border-t border-slate-100">
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => rotate(d)}><KeyRound className="w-3.5 h-3.5" /> New key</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => toggle(d)}><Power className="w-3.5 h-3.5" /> {d.is_active ? 'Disable' : 'Enable'}</Button>
                  <Button variant="ghost" size="sm" className={`h-7 text-xs gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 ${confirmDelete === d.id ? 'bg-red-50' : ''}`} onClick={() => remove(d)}>
                    <Trash2 className="w-3.5 h-3.5" /> {confirmDelete === d.id ? 'Remove?' : 'Remove'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {devices.length === 0 && (
            <Card className="border-dashed border-slate-300 shadow-none sm:col-span-2 lg:col-span-3">
              <CardContent className="p-6 text-center text-sm text-slate-500">
                No devices yet. Add one to get an API key for the machine or its sync software.
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="border-0 shadow-md">
          <CardHeader className="border-b border-slate-100 p-3 sm:p-5 space-y-3">
            <CardTitle className="text-base sm:text-lg">Device user IDs</CardTitle>
            <p className="text-xs sm:text-sm text-slate-500 -mt-2">The number each person is enrolled under on the machine.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input className="pl-9" placeholder="Search employees" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Button variant="outline" className="gap-1.5" onClick={() => exportCsv('device-user-ids', mapping, [
                { key: 'employee_id', label: 'Employee ID' }, { key: 'full_name', label: 'Name' },
                { key: 'department', label: 'Department' }, { key: 'device_user_id', label: 'Device user ID' },
              ])}>
                <Download className="w-4 h-4" /> Export CSV
              </Button>
              <Button onClick={saveMapping} disabled={!pending} className="bg-slate-800 hover:bg-slate-900 gap-1.5">
                <Save className="w-4 h-4" /> Save{pending ? ` (${pending})` : ''}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto max-h-[520px]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Employee</th>
                  <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Department</th>
                  <th className="text-left font-medium px-4 py-3 w-40">Device user ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map(e => (
                  <tr key={e.employee_id}>
                    <td className="px-4 py-2">
                      <p className="font-medium text-slate-900">{e.full_name}</p>
                      <p className="text-xs text-slate-500">{e.employee_id}</p>
                    </td>
                    <td className="px-4 py-2 text-slate-600 hidden sm:table-cell">{e.department || '—'}</td>
                    <td className="px-4 py-2">
                      <Input
                        className="h-8"
                        value={edits[e.employee_id] ?? e.device_user_id ?? ''}
                        placeholder="—"
                        aria-label={`Device user ID for ${e.full_name}`}
                        onChange={(ev) => setEdits({ ...edits, [e.employee_id]: ev.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add device</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="dv-name">Name</Label><Input id="dv-name" value={form.name} placeholder="Front door" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="dv-loc">Location</Label><Input id="dv-loc" value={form.location} placeholder="HQ, ground floor" onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="biometric">Fingerprint</SelectItem>
                  <SelectItem value="face">Face recognition</SelectItem>
                  <SelectItem value="rfid">RFID card</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={create} disabled={!form.name.trim()} className="bg-slate-800 hover:bg-slate-900">Add device</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <KeyDialog apiKey={revealedKey} onClose={() => setRevealedKey(null)} />
    </div>
  );
};

export default DevicesPage;
