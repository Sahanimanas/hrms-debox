import { useParams, useNavigate } from 'react-router-dom';
import { BarChart3, ArrowLeft, Users, Percent, Gauge, Lock, ShieldAlert, Download, MessageSquareText } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { exportCsv } from '@/lib/exportCsv';
import { PageShell, PageHeader, StateSwitch, StatCard, ExportButton } from '../components/PageShell';
import { API, QUESTION_TYPE_LABELS, useApi, fmtDateTime, downloadFromApi, blobErrorMessage } from '../lib';

const BAR = '#334155';

// Diverging eNPS segments: detractors / passives (neutral) / promoters. Always labelled.
const NPS_SEGMENTS = [
  { key: 'detractors', label: 'Detractors (0–6)', color: '#e11d48' },
  { key: 'passives', label: 'Passives (7–8)', color: '#94a3b8' },
  { key: 'promoters', label: 'Promoters (9–10)', color: '#059669' },
];

function DistributionChart({ distribution }) {
  const rows = Object.entries(distribution).map(([score, count]) => ({ score, count }));
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="score" tickLine={false} axisLine={false} fontSize={12} stroke="#64748b" />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} stroke="#94a3b8" />
          <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => [v, 'Responses']} labelFormatter={(l) => `Score ${l}`} />
          <Bar dataKey="count" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function EnpsBar({ enps }) {
  const total = enps.promoters + enps.passives + enps.detractors;
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full gap-0.5 rounded-full overflow-hidden bg-slate-100" role="img" aria-label="eNPS breakdown">
        {NPS_SEGMENTS.map(s => enps[s.key] > 0 && (
          <div key={s.key} style={{ width: `${(enps[s.key] / total) * 100}%`, background: s.color }} title={`${s.label}: ${enps[s.key]}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {NPS_SEGMENTS.map(s => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}: <strong className="text-slate-900">{enps[s.key]}</strong> ({total ? Math.round((enps[s.key] / total) * 100) : 0}%)
          </span>
        ))}
      </div>
    </div>
  );
}

function ChoiceBars({ options }) {
  return (
    <ul className="space-y-2">
      {options.map(o => (
        <li key={o.option} className="text-sm">
          <div className="flex justify-between gap-2 mb-1">
            <span className="text-slate-700 break-words">{o.option}</span>
            <span className="text-slate-500 shrink-0">{o.count} · {o.percent}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${o.percent}%`, background: BAR }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function QuestionResult({ q, index }) {
  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="p-3 sm:p-5 pb-2 sm:pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm sm:text-base font-semibold break-words">{index + 1}. {q.text}</CardTitle>
          <Badge variant="outline" className="text-[10px] shrink-0">{QUESTION_TYPE_LABELS[q.type]}</Badge>
        </div>
        {!q.hidden && <p className="text-xs text-slate-500">{q.answered} answered{q.average != null ? ` · average ${q.average}` : ''}</p>}
      </CardHeader>
      <CardContent className="p-3 sm:p-5 pt-0 space-y-3">
        {q.hidden && <p className="text-xs text-slate-500 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" />Hidden until enough people respond</p>}
        {!q.hidden && (q.type === 'rating' || q.type === 'nps') && <DistributionChart distribution={q.distribution} />}
        {!q.hidden && q.type === 'nps' && q.enps && (
          <>
            <p className="text-sm">eNPS <strong className="text-lg text-slate-900 ml-1">{q.enps.score > 0 ? `+${q.enps.score}` : q.enps.score}</strong></p>
            <EnpsBar enps={q.enps} />
          </>
        )}
        {!q.hidden && q.options && <ChoiceBars options={q.options} />}
        {!q.hidden && q.type === 'text' && (
          q.responses?.length ? (
            <ul className="space-y-2 max-h-72 overflow-y-auto">
              {q.responses.map((t, i) => (
                <li key={i} className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2 break-words flex gap-2">
                  <MessageSquareText className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />{t}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-slate-500">No written answers</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function SurveyResultsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi(`${API}/surveys/${id}/results`);
  const survey = data?.survey;

  const exportSummary = () => {
    const rows = [];
    for (const q of data.questions) {
      if (q.hidden) continue;
      if (q.distribution) Object.entries(q.distribution).forEach(([k, v]) => rows.push({ question: q.text, type: q.type, answer: k, count: v, average: q.average }));
      if (q.options) q.options.forEach(o => rows.push({ question: q.text, type: q.type, answer: o.option, count: o.count, percent: o.percent }));
      if (q.responses) q.responses.forEach(t => rows.push({ question: q.text, type: q.type, answer: t }));
    }
    exportCsv(`survey-summary`, rows, [
      { key: 'question', label: 'Question' },
      { key: 'type', label: 'Type' },
      { key: 'answer', label: 'Answer / score' },
      { key: 'count', label: 'Count' },
      { key: 'percent', label: 'Percent' },
      { key: 'average', label: 'Average' },
    ]);
  };

  const exportRaw = async () => {
    try {
      await downloadFromApi(`${API}/surveys/${id}/export`, `survey-responses.csv`);
    } catch (err) {
      toast.error(await blobErrorMessage(err, 'Could not export'));
    }
  };

  return (
    <PageShell>
      <PageHeader
        icon={BarChart3}
        title={survey?.title || 'Survey results'}
        subtitle={survey ? `${survey.anonymous ? 'Anonymous · ' : ''}${survey.state}${survey.closes_at ? ` · closes ${fmtDateTime(survey.closes_at)}` : ''}` : 'Results'}
        actions={(
          <>
            <Button variant="outline" className="gap-2 text-xs sm:text-sm h-9 sm:h-10 w-full sm:w-auto rounded-lg sm:rounded-xl" onClick={() => navigate('/engagement/surveys')}>
              <ArrowLeft className="w-4 h-4" />Back
            </Button>
            <ExportButton onClick={exportSummary} disabled={!data || data.insufficient_responses} />
            <Button variant="outline" className="gap-2 text-xs sm:text-sm h-9 sm:h-10 w-full sm:w-auto rounded-lg sm:rounded-xl" onClick={exportRaw} disabled={!data?.response_count || data.insufficient_responses}>
              <Download className="w-4 h-4" />Raw responses
            </Button>
          </>
        )}
      />
      <StateSwitch loading={loading} error={error} onRetry={reload}>
        {data && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">
              <StatCard label="Responses" value={data.response_count} icon={Users} tone="slate" />
              <StatCard label="Response rate" value={`${data.response_rate}%`} icon={Percent} tone="sky" />
              <StatCard label="eNPS" value={data.enps ? (data.enps.score > 0 ? `+${data.enps.score}` : data.enps.score) : '—'} icon={Gauge} tone="emerald" />
            </div>

            {data.insufficient_responses && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                To protect anonymity, results appear once at least {data.min_responses} people respond ({data.response_count} so far).
              </div>
            )}

            {data.enps && (
              <Card className="border-0 shadow-md">
                <CardContent className="p-3 sm:p-5 space-y-2">
                  <p className="text-sm font-medium text-slate-900">Employee Net Promoter Score</p>
                  <p className="text-xs text-slate-500">% promoters − % detractors ({data.enps.promoters_percent}% − {data.enps.detractors_percent}%)</p>
                  <EnpsBar enps={data.enps} />
                </CardContent>
              </Card>
            )}

            {data.by_department?.length > 0 && (
              <Card className="border-0 shadow-md">
                <CardHeader className="border-b border-slate-100 p-3 sm:p-5">
                  <CardTitle className="text-base">By department</CardTitle>
                  {data.hidden_departments > 0 && <p className="text-xs text-slate-500">{data.hidden_departments} department(s) hidden — fewer than {data.min_responses} responses</p>}
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600 text-xs">
                      <tr>
                        <th className="text-left font-medium px-4 py-2">Department</th>
                        <th className="text-right font-medium px-4 py-2">Responses</th>
                        <th className="text-right font-medium px-4 py-2">Avg rating</th>
                        <th className="text-right font-medium px-4 py-2">eNPS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.by_department.map(d => (
                        <tr key={d.department}>
                          <td className="px-4 py-2">{d.department}</td>
                          <td className="px-4 py-2 text-right">{d.responses}</td>
                          <td className="px-4 py-2 text-right">{d.average_rating ?? '—'}</td>
                          <td className="px-4 py-2 text-right">{d.enps ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
              {data.questions.map((q, i) => <QuestionResult key={q.id} q={q} index={i} />)}
            </div>
          </div>
        )}
      </StateSwitch>
    </PageShell>
  );
}
