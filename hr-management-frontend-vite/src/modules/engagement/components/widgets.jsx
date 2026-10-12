// Dashboard widgets for the engagement module.
import { Link } from 'react-router-dom';
import { Megaphone, PartyPopper, Award, Pin, Cake, Heart, ArrowRight, FileCheck2, ClipboardList, Vote } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Markdown from './Markdown';
import { Avatar } from './PageShell';
import { API, useApi, timeAgo, fmtDate, valueTone } from '../lib';

function WidgetCard({ icon, title, to, children }) {
  const Icon = icon;
  return (
    <Card className="border-slate-100 shadow-sm">
      <CardHeader className="p-3 sm:p-4 md:p-6 pb-2 sm:pb-3 flex flex-row items-center justify-between space-y-0 gap-2">
        <CardTitle className="text-lg sm:text-xl font-semibold text-slate-900 flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
          <Icon className="w-5 h-5 text-slate-600" />{title}
        </CardTitle>
        <Link to={to} className="text-xs text-sky-700 hover:underline flex items-center gap-1 shrink-0">View all<ArrowRight className="w-3 h-3" /></Link>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 md:p-6 pt-0">{children}</CardContent>
    </Card>
  );
}

const Muted = ({ children }) => <p className="text-sm text-slate-500 py-2">{children}</p>;

export function AnnouncementsWidget() {
  const { data, loading, error } = useApi(`${API}/announcements/feed`, { params: { limit: 3 } });
  const items = data?.announcements || [];
  return (
    <WidgetCard icon={Megaphone} title="Announcements" to="/engagement/announcements">
      {loading ? <Muted>Loading…</Muted> : error ? <Muted>Couldn't load announcements</Muted> : !items.length ? <Muted>No announcements right now</Muted> : (
        <ul className="space-y-3">
          {items.map(a => (
            <li key={a.id} className="p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2 flex-wrap">
                {!a.is_read && <span className="w-2 h-2 rounded-full bg-sky-500" aria-label="Unread" />}
                {a.pinned && <Pin className="w-3.5 h-3.5 text-amber-500" />}
                <p className="font-medium text-sm text-slate-900 break-words">{a.title}</p>
                <span className="text-[11px] text-slate-500">{timeAgo(a.published_at)}</span>
              </div>
              <Markdown text={a.body} clamp={1} className="mt-1 text-xs sm:text-sm line-clamp-3" />
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

export function CelebrationsWidget() {
  const { data, loading, error } = useApi(`${API}/celebrations`, { params: { days: 7 } });
  const list = (data?.celebrations || []).slice(0, 6);
  return (
    <WidgetCard icon={PartyPopper} title="Celebrations" to="/engagement/celebrations">
      {loading ? <Muted>Loading…</Muted> : error ? <Muted>Couldn't load celebrations</Muted> : !list.length ? <Muted>No birthdays or anniversaries this week</Muted> : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {list.map(c => (
            <li key={c.key} className={`flex items-center gap-2 p-2 rounded-lg ${c.is_today ? 'bg-amber-50' : 'bg-slate-50'}`}>
              <Avatar name={c.employee.full_name} seed={c.employee.id} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="text-sm text-slate-900 truncate block">{c.employee.full_name}</span>
                <span className="text-[11px] text-slate-500 flex items-center gap-1">
                  {c.type === 'birthday' ? <Cake className="w-3 h-3 text-rose-500" /> : <Award className="w-3 h-3 text-amber-500" />}
                  {c.type === 'birthday' ? 'Birthday' : `${c.years}y anniversary`} · {c.is_today ? 'Today' : fmtDate(c.date, 'EEE dd MMM')}
                </span>
              </span>
              {c.wish_count > 0 && <span className="text-[11px] text-slate-500 flex items-center gap-0.5"><Heart className="w-3 h-3 text-rose-400" />{c.wish_count}</span>}
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

export function KudosWidget() {
  const { data, loading, error } = useApi(`${API}/kudos`, { params: { limit: 3 } });
  const list = data?.kudos || [];
  return (
    <WidgetCard icon={Award} title="Recent kudos" to="/engagement/kudos">
      {loading ? <Muted>Loading…</Muted> : error ? <Muted>Couldn't load kudos</Muted> : !list.length ? <Muted>No kudos yet — recognise a colleague!</Muted> : (
        <ul className="space-y-2">
          {list.map(k => (
            <li key={k.id} className="p-3 bg-slate-50 rounded-lg space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs sm:text-sm text-slate-700 truncate">
                  <span className="font-medium text-slate-900">{k.from.full_name}</span> → {k.recipients.map(r => r.full_name).join(', ')}
                </p>
                <Badge variant="outline" className={`${valueTone(k.value)} text-[10px] shrink-0`}>{k.value}</Badge>
              </div>
              <p className="text-xs text-slate-600 line-clamp-2 break-words">{k.message}</p>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

export function EngagementTodoWidget() {
  const { data } = useApi(`${API}/summary`);
  if (!data) return null;
  const items = [
    { n: data.pending_policies, label: 'policy to acknowledge', plural: 'policies to acknowledge', to: '/engagement/policies', icon: FileCheck2, tone: 'text-amber-600 bg-amber-50' },
    { n: data.open_surveys, label: 'survey waiting for you', plural: 'surveys waiting for you', to: '/engagement/surveys', icon: ClipboardList, tone: 'text-sky-600 bg-sky-50' },
    { n: data.open_polls, label: 'open poll', plural: 'open polls', to: '/engagement/polls', icon: Vote, tone: 'text-purple-600 bg-purple-50' },
    { n: data.unread_announcements, label: 'unread announcement', plural: 'unread announcements', to: '/engagement/announcements', icon: Megaphone, tone: 'text-slate-600 bg-slate-100' },
  ].filter(i => i.n > 0);
  if (!items.length) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
      {items.map(i => {
        const Icon = i.icon;
        return (
          <Link key={i.to} to={i.to} className="flex items-center gap-3 p-3 rounded-xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
            <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${i.tone}`}><Icon className="w-4 h-4" /></span>
            <span className="text-sm text-slate-700"><strong className="text-slate-900">{i.n}</strong> {i.n === 1 ? i.label : i.plural}</span>
          </Link>
        );
      })}
    </div>
  );
}
