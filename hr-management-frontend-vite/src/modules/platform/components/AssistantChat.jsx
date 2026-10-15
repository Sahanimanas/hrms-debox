import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Send, Trash2, User, Sparkles, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import api from '@/lib/api';
import { errorMessage } from '../lib';

const SUGGESTIONS = [
  'How many casual leaves do I have left?',
  'When is the next holiday?',
  'Summarise my attendance this month',
  'What does my latest payslip look like?',
];
const ADMIN_SUGGESTIONS = ['How many approvals are pending?', 'Headcount by department'];

/** Minimal formatting: paragraphs and "- " / "* " bullet lists; **bold**. */
const renderText = (text) => {
  const blocks = String(text || '').split(/\n{2,}/);
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <React.Fragment key={i}>{part}</React.Fragment>);
  return blocks.map((block, i) => {
    const lines = block.split('\n');
    if (lines.every(l => /^\s*[-*•]\s+/.test(l))) {
      return <ul key={i} className="list-disc pl-5 space-y-0.5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>)}</ul>;
    }
    return <p key={i} className="whitespace-pre-wrap">{inline(block)}</p>;
  });
};

/**
 * Chat with the AI HR assistant. Used by the AI Assistant page and the
 * floating widget. `compact` tightens spacing for the widget.
 */
const AssistantChat = ({ compact = false, isAdmin = false }) => {
  const [status, setStatus] = useState(null); // { configured, model }
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [s, h] = await Promise.all([api.get('/v2/platform/assistant/status'), api.get('/v2/platform/assistant/history')]);
      setStatus(s.data);
      setMessages(h.data?.messages || []);
    } catch (error) {
      setLoadError(errorMessage(error, 'Could not load the assistant'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, sending]);

  const send = async (text) => {
    const message = (text ?? input).trim();
    if (!message || sending) return;
    setInput('');
    setSending(true);
    setMessages(prev => [...prev, { role: 'user', text: message, at: new Date().toISOString(), pending: true }]);
    try {
      const r = await api.post('/v2/platform/assistant/chat', { message });
      setMessages(r.data.messages || []);
    } catch (error) {
      setMessages(prev => prev.filter(m => !m.pending));
      setInput(message);
      if (error.response?.data?.configured === false) setStatus({ configured: false });
      toast.error(errorMessage(error, 'The assistant could not answer right now'));
    } finally {
      setSending(false);
    }
  };

  const clear = async () => {
    try {
      await api.delete('/v2/platform/assistant/history');
      setMessages([]);
      toast.success('Conversation cleared');
    } catch (error) {
      toast.error(errorMessage(error, 'Could not clear the conversation'));
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-12">
        <div className="animate-spin w-7 h-7 border-4 border-slate-200 border-t-slate-800 rounded-full" />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-12 text-center px-4">
        <p className="text-sm text-red-600">{loadError}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={load}>Try again</Button>
      </div>
    );
  }
  if (!status?.configured) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-6">
        <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mb-3">
          <PlugZap className="w-6 h-6 text-slate-500" />
        </div>
        <p className="font-semibold text-slate-900">AI assistant is not configured</p>
        {isAdmin ? (
          <>
            <p className="text-sm text-slate-500 mt-1 max-w-sm">
              Add an Anthropic API key to turn the assistant on for everyone.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link to="/ai-settings">Set up AI assistant</Link>
            </Button>
          </>
        ) : (
          <p className="text-sm text-slate-500 mt-1 max-w-sm">
            Your administrator hasn't connected an AI provider yet. In the meantime you can find your leave, attendance and payslips from the menu.
          </p>
        )}
      </div>
    );
  }

  const suggestions = isAdmin ? [...SUGGESTIONS.slice(0, 2), ...ADMIN_SUGGESTIONS] : SUGGESTIONS;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className={`flex-1 overflow-y-auto ${compact ? 'p-3' : 'p-4 sm:p-5'} space-y-3`} aria-live="polite">
        {messages.length === 0 && (
          <div className="text-center py-6">
            <Sparkles className="w-8 h-8 text-yellow-500 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-800">Ask about your leave, attendance, payslips, holidays or company policies.</p>
            <p className="text-xs text-slate-500 mt-1">The assistant only sees your own records.</p>
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {suggestions.map(s => (
                <button key={s} type="button" onClick={() => send(s)} className="text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white hover:border-slate-400 text-slate-700">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={`${m.at}-${i}`} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role !== 'user' && (
              <div className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center shrink-0 mt-0.5"><Bot className="w-4 h-4 text-yellow-400" /></div>
            )}
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm space-y-2 ${m.role === 'user' ? 'bg-slate-800 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'}`}>
              {renderText(m.text)}
            </div>
            {m.role === 'user' && (
              <div className="w-7 h-7 rounded-lg bg-slate-200 flex items-center justify-center shrink-0 mt-0.5"><User className="w-4 h-4 text-slate-600" /></div>
            )}
          </div>
        ))}
        {sending && (
          <div className="flex gap-2 items-center text-xs text-slate-500">
            <div className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center"><Bot className="w-4 h-4 text-yellow-400" /></div>
            <span className="animate-pulse">Looking that up…</span>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className={`border-t border-slate-200 bg-white ${compact ? 'p-2' : 'p-3'} flex items-end gap-2`}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask a question…"
          rows={1}
          maxLength={2000}
          className="min-h-[40px] max-h-32 resize-none text-sm"
          aria-label="Message"
        />
        <Button type="submit" size="icon" disabled={sending || !input.trim()} className="shrink-0" aria-label="Send">
          <Send className="w-4 h-4" />
        </Button>
        {messages.length > 0 && (
          <Button type="button" size="icon" variant="ghost" onClick={clear} className="shrink-0 text-slate-500" aria-label="Clear conversation" title="Clear conversation">
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </form>
    </div>
  );
};

export default AssistantChat;
