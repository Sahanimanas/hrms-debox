import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Plus, CheckCircle2, Lock, BarChart3, Pencil, Trash2, Send, XCircle, Download, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import api from '@/lib/api';
import { exportCsv } from '@/lib/exportCsv';
import SurveyBuilder from '../components/SurveyBuilder';
import SurveyForm from '../components/SurveyForm';
import { PageShell, PageHeader, StateSwitch, ExportButton } from '../components/PageShell';
import { API, PRIMARY_BTN, useApi, isAdmin, errorMessage, fmtDate, fmtDateTime, audienceLabel, downloadFromApi, blobErrorMessage } from '../lib';

const STATE_STYLES = {
  draft: 'bg-slate-100 text-slate-600',
  scheduled: 'bg-sky-100 text-sky-700',
  open: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-slate-200 text-slate-600',
};

function OpenSurveys({ onAnswer, version }) {
  const { data, loading, error, reload } = useApi(`${API}/surveys`, { initial: [], params: { state: 'open', v: version } });
  const list = data || [];
  return (
    <StateSwitch loading={loading} error={error} onRetry={reload} empty={!list.length}
      emptyProps={{ icon: ClipboardList, title: 'No open surveys', hint: 'When HR runs a survey for you, it will show up here.' }}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {list.map(s => (
          <Card key={s.id} className="border-0 shadow-md">
            <CardContent className="p-4 sm:p-5 flex flex-col gap-3 h-full">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-slate-900 break-words">{s.title}</h3>
                {s.anonymous && <Badge variant="outline" className="text-[10px] gap-1 shrink-0"><Lock className="w-3 h-3" />Anonymous</Badge>}
              </div>
              {s.description && <p className="text-xs sm:text-sm text-slate-600 line-clamp-3 whitespace-pre-line">{s.description}</p>}
              <p className="text-xs text-slate-500 mt-auto">{s.question_count} question{s.question_count === 1 ? '' : 's'}{s.closes_at ? ` · closes ${fmtDateTime(s.closes_at)}` : ''}</p>
              {s.responded ? (
                <p className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 className="w-4 h-4" />Submitted — thank you!</p>
              ) : (
                <Button className="w-full sm:w-auto" onClick={() => onAnswer(s.id)}>Take survey</Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </StateSwitch>
  );
}

function ManageSurveys() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi(`${API}/surveys`, { initial: [] });
  const [builder, setBuilder] = useState(null);
  const list = data || [];

  const act = async (fn, ok) => {
    try {
      await fn();
      toast.success(ok);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const exportRaw = async (s) => {
    try {
      await downloadFromApi(`${API}/surveys/${s.id}/export`, `survey-${s.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`);
    } catch (err) {
      toast.error(await blobErrorMessage(err, 'Could not export'));
    }
  };

  const download = () => exportCsv('surveys', list, [
    { key: 'title', label: 'Survey' },
    { key: 'state', label: 'State' },
    { label: 'Anonymous', value: r => (r.anonymous ? 'Yes' : 'No') },
    { label: 'Audience', value: r => audienceLabel(r.audience) },
    { key: 'question_count', label: 'Questions' },
    { key: 'response_count', label: 'Responses' },
    { label: 'Opens', value: r => r.opens_at || '' },
    { label: 'Closes', value: r => r.closes_at || '' },
    { label: 'Created', value: r => r.created_at },
  ]);

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-base sm:text-lg">All surveys</CardTitle>
          <div className="flex flex-col sm:flex-row gap-2">
            <ExportButton onClick={download} disabled={!list.length} />
            <Button className={PRIMARY_BTN} onClick={() => setBuilder({})}><Plus className="w-4 h-4" />New survey</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <StateSwitch loading={loading} error={error} onRetry={reload} empty={!list.length}
          emptyProps={{ icon: ClipboardList, title: 'No surveys yet', hint: 'Build a pulse or eNPS survey and see results as they come in.' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Survey</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Window</th>
                  <th className="text-left font-medium px-4 py-3">Responses</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 min-w-[170px]">
                      <p className="font-medium text-slate-900 break-words">{s.title}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <Badge variant="outline" className={`${STATE_STYLES[s.state]} border-0 text-[10px] capitalize`}>{s.state}</Badge>
                        {s.anonymous && <Badge variant="outline" className="text-[10px] gap-1"><Lock className="w-3 h-3" />Anonymous</Badge>}
                        <span className="text-[11px] text-slate-500">{audienceLabel(s.audience)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-600 whitespace-nowrap">
                      {s.opens_at && <span className="flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" />{fmtDate(s.opens_at)}</span>}
                      {s.closes_at ? `Closes ${fmtDate(s.closes_at)}` : 'No close date'}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{s.response_count || 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1 flex-wrap">
                        {s.state !== 'draft' && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Results" onClick={() => navigate(`/engagement/surveys/${s.id}/results`)}><BarChart3 className="w-4 h-4" /></Button>
                        )}
                        {s.response_count > 0 && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Export responses" onClick={() => exportRaw(s)}><Download className="w-4 h-4" /></Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => setBuilder(s)}><Pencil className="w-4 h-4" /></Button>
                        {(s.state === 'draft' || (s.state === 'closed' && (!s.closes_at || new Date(s.closes_at) > new Date()))) && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-700" title={s.state === 'draft' ? 'Publish' : 'Reopen'} onClick={() => act(() => api.post(`${API}/surveys/${s.id}/publish`), s.state === 'draft' ? 'Survey published' : 'Survey reopened')}><Send className="w-4 h-4" /></Button>
                        )}
                        {(s.state === 'open' || s.state === 'scheduled') && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Close now" onClick={() => window.confirm('Close this survey now?') && act(() => api.post(`${API}/surveys/${s.id}/close`), 'Survey closed')}><XCircle className="w-4 h-4" /></Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600" title="Delete" onClick={() => window.confirm(`Delete "${s.title}" and all responses?`) && act(() => api.delete(`${API}/surveys/${s.id}`), 'Survey deleted')}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateSwitch>
      </CardContent>
      {builder && (
        <SurveyBuilder
          key={builder.id || 'new'}
          survey={builder.id ? builder : null}
          onClose={() => setBuilder(null)}
          onSaved={() => { setBuilder(null); reload(); }}
        />
      )}
    </Card>
  );
}

export default function SurveysPage() {
  const admin = isAdmin();
  const [answering, setAnswering] = useState(null);
  const [version, setVersion] = useState(0);
  const open = <OpenSurveys onAnswer={setAnswering} version={version} />;
  return (
    <PageShell>
      <PageHeader icon={ClipboardList} title="Surveys" subtitle="Share your feedback — anonymous surveys never reveal who answered" />
      {admin ? (
        <Tabs defaultValue="manage">
          <TabsList>
            <TabsTrigger value="manage">Manage</TabsTrigger>
            <TabsTrigger value="open">Open for me</TabsTrigger>
          </TabsList>
          <TabsContent value="manage" className="mt-4"><ManageSurveys /></TabsContent>
          <TabsContent value="open" className="mt-4">{open}</TabsContent>
        </Tabs>
      ) : open}
      {answering && (
        <SurveyForm key={answering} surveyId={answering} onClose={() => setAnswering(null)} onSubmitted={() => { setAnswering(null); setVersion(v => v + 1); }} />
      )}
    </PageShell>
  );
}
