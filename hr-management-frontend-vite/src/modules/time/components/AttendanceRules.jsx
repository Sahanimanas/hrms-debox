import React, { useState, useEffect, useCallback } from 'react';
import { MoonStar, Play } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { format } from 'date-fns';
import api from '@/lib/api';

/**
 * Nightly close settings (TA-11): auto-absent and missed clock-out handling.
 */
const AttendanceRules = () => {
  const [settings, setSettings] = useState(null);
  const [runs, setRuns] = useState([]);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api.get('/time/settings'), api.get('/time/close-runs')]);
      setSettings(s.data);
      setRuns(r.data || []);
    } catch {
      toast.error('Failed to load attendance rules');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = async (patch) => {
    try {
      const res = await api.put('/time/settings', patch);
      setSettings(res.data);
      toast.success('Saved');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save');
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await api.post('/time/close-day', {});
      toast.success(`Closed ${res.data.date}: ${res.data.missed_clock_outs} missed clock-out(s), ${res.data.marked_absent} marked absent`);
      load();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to run');
    } finally {
      setRunning(false);
    }
  };

  if (!settings) return null;

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <CardTitle className="text-base sm:text-lg flex items-center gap-2">
          <MoonStar className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" /> Nightly attendance close
        </CardTitle>
        <p className="text-xs sm:text-sm text-slate-500">Runs every night at 1:30 AM for the previous day.</p>
      </CardHeader>
      <CardContent className="p-3 sm:p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-900">Mark absentees automatically</p>
            <p className="text-xs text-slate-500">Anyone with no punch, no attendance mark and no leave on a working day is marked absent. Leave off if you still mark attendance by hand.</p>
          </div>
          <Switch checked={settings.auto_absent_enabled} onCheckedChange={(v) => update({ auto_absent_enabled: v })} aria-label="Mark absentees automatically" />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-slate-900">When someone forgets to clock out</p>
            <p className="text-xs text-slate-500">They're always notified to raise a correction.</p>
          </div>
          <Select value={settings.missed_clock_out_action} onValueChange={(v) => update({ missed_clock_out_action: v })}>
            <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="flag">Keep present, flag the day</SelectItem>
              <SelectItem value="half_day">Count it as a half day</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-500">
            {runs[0] ? `Last run ${format(new Date(runs[0].ran_at), 'dd MMM, h:mm a')} for ${runs[0].date}: ${runs[0].missed_clock_outs} missed clock-out(s), ${runs[0].marked_absent} absent` : 'Not run yet'}
          </p>
          <Button variant="outline" size="sm" onClick={runNow} disabled={running} className="gap-1.5">
            <Play className="w-3.5 h-3.5" /> {running ? 'Running…' : "Run now for yesterday"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default AttendanceRules;
