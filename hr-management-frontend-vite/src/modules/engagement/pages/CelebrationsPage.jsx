import { useState } from 'react';
import { PartyPopper, Cake, Award, Send, Heart, MessageCircleHeart, CalendarDays, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, PageHeader, StateSwitch, ExportButton, StatCard, Avatar } from '../components/PageShell';
import { API, useApi, isAdmin, errorMessage, fmtDate, timeAgo } from '../lib';

const QUICK_WISHES = {
  birthday: ['Happy birthday! 🎂 Have a fantastic day!', 'Wishing you a wonderful year ahead! 🎉', 'Many happy returns of the day! 🥳'],
  anniversary: ['Happy work anniversary! 🎉 Thanks for everything you do.', 'Congratulations on another great year! 🙌', 'Cheers to your milestone! 🥂'],
};

const whenLabel = (c) => {
  if (c.is_today) return 'Today';
  if (c.days_away === 1) return 'Tomorrow';
  return fmtDate(c.date, 'EEE, dd MMM');
};

function CelebrationRow({ c, onWish, admin }) {
  const isBirthday = c.type === 'birthday';
  const Icon = isBirthday ? Cake : Award;
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl ${c.is_today ? 'bg-gradient-to-r from-amber-50 to-rose-50 border border-amber-100' : 'bg-white border border-slate-100'}`}>
      <Avatar name={c.employee.full_name} seed={c.employee.id} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm text-slate-900 truncate">
          {c.employee.full_name}{c.is_me && <span className="text-slate-500 font-normal"> (you)</span>}
        </p>
        <p className="text-xs text-slate-500 flex items-center gap-1 flex-wrap">
          <Icon className={`w-3.5 h-3.5 ${isBirthday ? 'text-rose-500' : 'text-amber-500'}`} />
          {isBirthday ? 'Birthday' : `${c.years} year${c.years === 1 ? '' : 's'} at work`}
          <span>· {whenLabel(c)}</span>
          {c.employee.department && <span className="hidden sm:inline">· {c.employee.department}</span>}
          {admin && c.date_of_birth && <span className="hidden md:inline">· Born {fmtDate(c.date_of_birth)} (turns {c.age})</span>}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {c.wish_count > 0 && (
          <span className="text-xs text-slate-500 flex items-center gap-1"><Heart className="w-3.5 h-3.5 text-rose-400" />{c.wish_count}</span>
        )}
        {!c.is_me && (
          c.i_wished
            ? <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-200">Wished</Badge>
            : <Button size="sm" variant={c.is_today ? 'default' : 'outline'} className={`h-8 text-xs gap-1 ${c.is_today ? 'bg-slate-800 hover:bg-slate-900' : ''}`} onClick={() => onWish(c)}>
                <Send className="w-3.5 h-3.5" /><span className="hidden sm:inline">Wish</span>
              </Button>
        )}
      </div>
    </div>
  );
}

function WishDialog({ target, onClose, onSent }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!message.trim()) return toast.error('Write a message');
    setSending(true);
    try {
      await api.post(`${API}/celebrations/wishes`, { employee_id: target.employee.id, type: target.type, message: message.trim() });
      toast.success('Wish sent 🎉');
      onSent();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not send your wish'));
    } finally {
      setSending(false);
    }
  };
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Wish {target?.employee.full_name}</DialogTitle>
          <DialogDescription>{target?.type === 'birthday' ? 'Birthday' : 'Work anniversary'} · {target && whenLabel(target)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {(QUICK_WISHES[target?.type] || []).map(q => (
              <button key={q} type="button" onClick={() => setMessage(q)} className="text-xs px-2.5 py-1 rounded-full border border-slate-200 hover:bg-slate-50 text-left">
                {q}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wish-msg">Your message</Label>
            <Textarea id="wish-msg" rows={4} maxLength={500} value={message} onChange={e => setMessage(e.target.value)} />
            <p className="text-[11px] text-slate-400 text-right">{message.length}/500</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="gap-2" onClick={send} disabled={sending}><Send className="w-4 h-4" />{sending ? 'Sending…' : 'Send wish'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MyWishes() {
  const { data, loading, error, reload } = useApi(`${API}/celebrations/wishes/mine`);
  if (loading || error || !data?.total) return null;
  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <CardTitle className="text-base sm:text-lg flex items-center gap-2">
          <MessageCircleHeart className="w-4 h-4 sm:w-5 sm:h-5 text-rose-500" />
          Wishes for you ({data.total})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-5 space-y-5">
        {data.celebrations.map(group => (
          <div key={group.key} className="space-y-2">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              {group.type === 'birthday' ? 'Birthday' : 'Work anniversary'} · {fmtDate(group.date)}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {group.wishes.map(w => (
                <div key={w.id} className="p-3 rounded-lg bg-rose-50/60 border border-rose-100">
                  <p className="text-sm text-slate-800 break-words">{w.message}</p>
                  <p className="text-[11px] text-slate-500 mt-1">— {w.from_name}{w.from_department ? `, ${w.from_department}` : ''} · {timeAgo(w.created_at)}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
        <Button variant="ghost" size="sm" className="text-xs" onClick={reload}>Refresh</Button>
      </CardContent>
    </Card>
  );
}

function AdminSettings() {
  const { data, setData } = useApi(`${API}/settings`);
  const [saving, setSaving] = useState(false);
  const toggle = async (value) => {
    setSaving(true);
    try {
      const res = await api.put(`${API}/settings`, { celebrations_company_wide: value });
      setData(res.data);
      toast.success(value ? 'Company-wide celebration notices on' : 'Company-wide celebration notices off');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card className="border-slate-100 shadow-sm">
      <CardContent className="p-3 sm:p-4 flex items-start sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <Settings2 className="w-4 h-4 mt-0.5 text-slate-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-slate-900">Notify the whole company</p>
            <p className="text-xs text-slate-500">Every morning at 9:00, celebrants get a personal greeting. Turn this on to also tell everyone else.</p>
          </div>
        </div>
        <Switch checked={!!data?.celebrations_company_wide} disabled={!data || saving} onCheckedChange={toggle} />
      </CardContent>
    </Card>
  );
}

export default function CelebrationsPage() {
  const admin = isAdmin();
  const [days, setDays] = useState('7');
  const { data, loading, error, reload } = useApi(`${API}/celebrations`, { params: { days: Number(days) } });
  const [target, setTarget] = useState(null);
  const list = data?.celebrations || [];
  const today = list.filter(c => c.is_today);
  const upcoming = list.filter(c => !c.is_today);

  const download = () => exportCsv('celebrations', list, [
    { label: 'Name', value: r => r.employee.full_name },
    { label: 'Department', value: r => r.employee.department },
    { label: 'Type', value: r => (r.type === 'birthday' ? 'Birthday' : 'Work anniversary') },
    { key: 'date', label: 'Date' },
    { label: 'Years', value: r => r.years ?? '' },
    ...(admin ? [{ label: 'Date of birth', value: r => r.date_of_birth || '' }] : []),
    { key: 'wish_count', label: 'Wishes' },
  ]);

  return (
    <PageShell>
      <PageHeader
        icon={PartyPopper}
        title="Celebrations"
        subtitle="Birthdays and work anniversaries"
        actions={(
          <>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="h-9 sm:h-10 w-full sm:w-40 text-xs sm:text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Next 7 days</SelectItem>
                <SelectItem value="14">Next 14 days</SelectItem>
                <SelectItem value="30">Next 30 days</SelectItem>
              </SelectContent>
            </Select>
            <ExportButton onClick={download} disabled={!list.length} />
          </>
        )}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">
        <StatCard label="Today" value={loading ? '—' : today.length} icon={PartyPopper} tone="rose" />
        <StatCard label="Birthdays" value={loading ? '—' : list.filter(c => c.type === 'birthday').length} icon={Cake} tone="amber" />
        <StatCard label="Anniversaries" value={loading ? '—' : list.filter(c => c.type === 'anniversary').length} icon={Award} tone="purple" />
      </div>

      {admin && <AdminSettings />}

      <MyWishes />

      <Card className="border-0 shadow-md">
        <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <CalendarDays className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
            Coming up
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-5">
          <StateSwitch
            loading={loading}
            error={error}
            onRetry={reload}
            empty={!list.length}
            emptyProps={{ icon: PartyPopper, title: 'No celebrations in this period', hint: 'Birthdays need a date of birth on the employee profile.' }}
          >
            <div className="space-y-5">
              {today.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-rose-600 uppercase tracking-wider">Today 🎉</p>
                  {today.map(c => <CelebrationRow key={c.key} c={c} admin={admin} onWish={setTarget} />)}
                </div>
              )}
              {upcoming.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Upcoming</p>
                  {upcoming.map(c => <CelebrationRow key={c.key} c={c} admin={admin} onWish={setTarget} />)}
                </div>
              )}
            </div>
          </StateSwitch>
        </CardContent>
      </Card>

      {target && <WishDialog key={target.key} target={target} onClose={() => setTarget(null)} onSent={() => { setTarget(null); reload(); }} />}
    </PageShell>
  );
}
