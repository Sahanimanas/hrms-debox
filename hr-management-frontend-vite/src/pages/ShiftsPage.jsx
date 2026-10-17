import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Clock3, Pencil, Trash2, Star, Users, Search, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import AttendanceRules from '@/modules/time/components/AttendanceRules';
import { fmtShiftTime, fmtMinutes, WEEKDAY_LABELS } from '@/lib/time';

const EMPTY_FORM = {
  name: '',
  start_time: '09:30',
  end_time: '18:30',
  grace_minutes: 15,
  early_exit_grace_minutes: 15,
  half_day_hours: 4,
  full_day_hours: 8,
  weekly_offs: [0],
  is_default: false,
};

const DEFAULT_SHIFT_VALUE = '__default__';

const ShiftsPage = () => {
  const [shifts, setShifts] = useState([]);
  const [fallback, setFallback] = useState(null);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [assignTo, setAssignTo] = useState('');
  const [search, setSearch] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(null);

  const fetchAll = async () => {
    try {
      const [shiftRes, rosterRes] = await Promise.all([
        api.get('/time/shifts'),
        api.get('/time/shift-roster'),
      ]);
      setShifts(shiftRes.data.shifts || []);
      setFallback(shiftRes.data.fallback_shift);
      setRoster(rosterRes.data || []);
    } catch {
      toast.error('Failed to load shifts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const shiftById = useMemo(() => Object.fromEntries(shifts.map(s => [s.id, s])), [shifts]);
  const defaultShift = shifts.find(s => s.is_default);

  const unassignedCount = roster.filter(e => !e.shift_id || !shiftById[e.shift_id]).length;
  const generalLabel = fallback ? `built-in ${fallback.name} shift (${fmtShiftTime(fallback.start_time)} – ${fmtShiftTime(fallback.end_time)})` : 'built-in General shift';

  // The default shift silently applies to everyone without an assigned shift, so ask first
  const confirmDefaultChange = (name, makingDefault) => window.confirm(makingDefault
    ? `Make "${name}" the default shift?

It applies to everyone without an assigned shift (${unassignedCount} employee${unassignedCount === 1 ? '' : 's'} right now): their working hours, late marks and half-day rules will follow this shift.`
    : `Stop using "${name}" as the default shift?

Employees without an assigned shift (${unassignedCount}) go back to the ${generalLabel}.`);

  const filteredRoster = roster.filter(e => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [e.full_name, e.email, e.department, e.employee_id].some(v => v?.toLowerCase().includes(q));
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };

  const openEdit = (shift) => {
    setEditing(shift);
    setForm({
      name: shift.name,
      start_time: shift.start_time,
      end_time: shift.end_time,
      grace_minutes: shift.grace_minutes,
      early_exit_grace_minutes: shift.early_exit_grace_minutes,
      half_day_hours: shift.half_day_minutes / 60,
      full_day_hours: shift.full_day_minutes / 60,
      weekly_offs: shift.weekly_offs || [],
      is_default: shift.is_default,
    });
    setDialogOpen(true);
  };

  const toggleOff = (day) => {
    const offs = form.weekly_offs.includes(day)
      ? form.weekly_offs.filter(d => d !== day)
      : [...form.weekly_offs, day].sort();
    setForm({ ...form, weekly_offs: offs });
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error('Give the shift a name');
    const payload = {
      name: form.name.trim(),
      start_time: form.start_time,
      end_time: form.end_time,
      grace_minutes: Number(form.grace_minutes) || 0,
      early_exit_grace_minutes: Number(form.early_exit_grace_minutes) || 0,
      half_day_minutes: Math.round(Number(form.half_day_hours) * 60) || 0,
      full_day_minutes: Math.round(Number(form.full_day_hours) * 60) || 0,
      weekly_offs: form.weekly_offs,
    };
    payload.is_default = form.is_default;
    const defaultChanged = editing ? form.is_default !== !!editing.is_default : form.is_default;
    if (defaultChanged && !confirmDefaultChange(payload.name, form.is_default)) return;

    setSaving(true);
    try {
      if (editing) {
        await api.put(`/time/shifts/${editing.id}`, payload);
        toast.success('Shift updated');
      } else {
        await api.post('/time/shifts', payload);
        toast.success('Shift created');
      }
      setDialogOpen(false);
      fetchAll();
    } catch (error) {
      const detail = error.response?.data?.errors?.[0]?.message || error.response?.data?.detail;
      toast.error(detail || 'Failed to save shift');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (shift) => {
    // First click arms the button, second click deletes
    if (confirmingDelete !== shift.id) {
      setConfirmingDelete(shift.id);
      setTimeout(() => setConfirmingDelete(c => (c === shift.id ? null : c)), 4000);
      return;
    }
    setConfirmingDelete(null);
    try {
      const res = await api.delete(`/time/shifts/${shift.id}`);
      toast.success(`Shift deleted${res.data.employees_moved_to_default ? ` · ${res.data.employees_moved_to_default} employee(s) moved to the default shift` : ''}`);
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete shift');
    }
  };

  const makeDefault = async (shift) => {
    if (!confirmDefaultChange(shift.name, true)) return;
    try {
      await api.put(`/time/shifts/${shift.id}`, { is_default: true });
      toast.success(`${shift.name} is now the default shift`);
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update shift');
    }
  };

  const assign = async () => {
    if (!assignTo || selected.size === 0) return;
    try {
      await api.put('/time/shifts-assign', {
        shift_id: assignTo === DEFAULT_SHIFT_VALUE ? null : assignTo,
        employee_ids: [...selected],
      });
      toast.success(`Shift assigned to ${selected.size} employee(s)`);
      setSelected(new Set());
      setAssignTo('');
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to assign shift');
    }
  };

  const toggleSelect = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const allVisibleSelected = filteredRoster.length > 0 && filteredRoster.every(e => selected.has(e.employee_id));
  const toggleAll = () => {
    const next = new Set(selected);
    filteredRoster.forEach(e => (allVisibleSelected ? next.delete(e.employee_id) : next.add(e.employee_id)));
    setSelected(next);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-slate-500">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-canvas p-3 sm:p-4 md:p-8">
      <div className="w-full space-y-5 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-2 sm:p-3 bg-slate-800 rounded-lg sm:rounded-xl shadow-lg">
              <Clock3 className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                Shifts
              </h1>
              <p className="text-xs sm:text-sm text-slate-600">Working hours, grace periods and weekly offs used for clock-in</p>
            </div>
          </div>
          <Button onClick={openCreate} className="rounded-lg sm:rounded-xl shadow-md gap-2 text-xs sm:text-sm h-9 sm:h-10 w-full sm:w-auto">
            <Plus className="w-4 h-4" /> New Shift
          </Button>
        </div>

        {!defaultShift && fallback && (
          <Card className="border-amber-200 bg-amber-50 shadow-none">
            <CardContent className="p-4 text-sm text-amber-800">
              {shifts.length === 0 ? 'No shifts yet.' : 'No default shift.'} Everyone without an assigned shift uses a built-in <b>{fallback.name}</b> shift
              ({fmtShiftTime(fallback.start_time)} – {fmtShiftTime(fallback.end_time)}, Sunday off).
            </CardContent>
          </Card>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {shifts.map((shift) => (
            <Card key={shift.id} className="border-slate-100 shadow-sm">
              <CardContent className="p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-900 truncate">{shift.name}</p>
                      {shift.is_default && <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 text-[10px]">Default</Badge>}
                    </div>
                    <p className="text-lg font-bold text-slate-900 mt-1">
                      {fmtShiftTime(shift.start_time)} – {fmtShiftTime(shift.end_time)}
                    </p>
                  </div>
                  <div className="flex shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(shift)} aria-label="Edit shift">
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size={confirmingDelete === shift.id ? 'sm' : 'icon'}
                      className={`h-8 text-red-600 hover:text-red-700 hover:bg-red-50 ${confirmingDelete === shift.id ? 'px-2 text-xs bg-red-50' : 'w-8'}`}
                      onClick={() => remove(shift)}
                      aria-label="Delete shift"
                    >
                      {confirmingDelete === shift.id ? 'Delete?' : <Trash2 className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <dt className="text-slate-500">Late after</dt>
                  <dd className="text-slate-900">{shift.grace_minutes} min grace</dd>
                  <dt className="text-slate-500">Full day</dt>
                  <dd className="text-slate-900">{fmtMinutes(shift.full_day_minutes)}</dd>
                  <dt className="text-slate-500">Half day</dt>
                  <dd className="text-slate-900">{fmtMinutes(shift.half_day_minutes)}</dd>
                  <dt className="text-slate-500">Weekly off</dt>
                  <dd className="text-slate-900">{shift.weekly_offs?.length ? shift.weekly_offs.map(d => WEEKDAY_LABELS[d]).join(', ') : 'None'}</dd>
                </dl>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" /> {shift.employee_count} employee{shift.employee_count === 1 ? '' : 's'}
                  </span>
                  {!shift.is_default && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => makeDefault(shift)}>
                      <Star className="w-3.5 h-3.5" /> Make default
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Roster */}
        <Card className="border-0 shadow-md">
          <CardHeader className="border-b border-slate-100 p-3 sm:p-5 space-y-3">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <Users className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" /> Assign Shifts
            </CardTitle>
            <div className="flex flex-col md:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input className="pl-9" placeholder="Search employees" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={assignTo} onValueChange={setAssignTo} disabled={shifts.length === 0}>
                <SelectTrigger className="md:w-56"><SelectValue placeholder="Choose shift" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_SHIFT_VALUE}>Default shift ({defaultShift?.name || fallback?.name || 'General'})</SelectItem>
                  {shifts.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => exportCsv('shift-roster', roster, [
                  { key: 'employee_id', label: 'Employee ID' },
                  { key: 'full_name', label: 'Name' },
                  { key: 'department', label: 'Department' },
                  { label: 'Shift', value: (e) => shiftById[e.shift_id]?.name || `${defaultShift?.name || fallback?.name || 'Default'} (default)` },
                ])}
              >
                <Download className="w-4 h-4" /> Export
              </Button>
              <Button onClick={assign} disabled={!assignTo || selected.size === 0}>
                Assign{selected.size ? ` to ${selected.size}` : ''}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[480px]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="px-4 py-3 w-10"><Checkbox checked={allVisibleSelected} onCheckedChange={toggleAll} aria-label="Select all" /></th>
                    <th className="text-left font-medium px-4 py-3">Employee</th>
                    <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">Department</th>
                    <th className="text-left font-medium px-4 py-3">Shift</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRoster.map(e => {
                    const shift = shiftById[e.shift_id];
                    return (
                      <tr key={e.employee_id} className="hover:bg-slate-50 cursor-pointer" onClick={() => toggleSelect(e.employee_id)}>
                        <td className="px-4 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                          <Checkbox checked={selected.has(e.employee_id)} onCheckedChange={() => toggleSelect(e.employee_id)} aria-label={`Select ${e.full_name}`} />
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-900">{e.full_name}</p>
                          <p className="text-xs text-slate-500">{e.employee_id}</p>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 hidden sm:table-cell">{e.department || '—'}</td>
                        <td className="px-4 py-2.5">
                          {shift ? shift.name : <span className="text-slate-500">{defaultShift ? `${defaultShift.name} (default)` : 'Default'}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <AttendanceRules />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit shift' : 'New shift'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="shift-name">Name</Label>
              <Input id="shift-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. General, Night" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="shift-start">Starts</Label>
                <Input id="shift-start" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shift-end">Ends</Label>
                <Input id="shift-end" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
              </div>
            </div>
            {form.end_time <= form.start_time && (
              <p className="text-xs text-purple-600 -mt-2">Ends the next day (overnight shift).</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="shift-grace">Late-arrival grace (min)</Label>
                <Input id="shift-grace" type="number" min="0" value={form.grace_minutes} onChange={(e) => setForm({ ...form, grace_minutes: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shift-early">Early-exit grace (min)</Label>
                <Input id="shift-early" type="number" min="0" value={form.early_exit_grace_minutes} onChange={(e) => setForm({ ...form, early_exit_grace_minutes: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shift-full">Full day needs (hours)</Label>
                <Input id="shift-full" type="number" min="0" step="0.5" value={form.full_day_hours} onChange={(e) => setForm({ ...form, full_day_hours: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shift-half">Half day needs (hours)</Label>
                <Input id="shift-half" type="number" min="0" step="0.5" value={form.half_day_hours} onChange={(e) => setForm({ ...form, half_day_hours: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-slate-500 -mt-2">Less than the half-day hours is marked absent.</p>
            <div className="space-y-1.5">
              <Label>Weekly offs</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_LABELS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleOff(day)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${form.weekly_offs.includes(day) ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div>
                <p className="text-sm font-medium text-slate-900">Default shift</p>
                <p className="text-xs text-slate-500">
                  Used for anyone without an assigned shift
                  {editing?.is_default && !form.is_default ? ` · they go back to the ${generalLabel}` : ''}
                </p>
              </div>
              <Switch checked={form.is_default} onCheckedChange={(v) => setForm({ ...form, is_default: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create shift'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ShiftsPage;
