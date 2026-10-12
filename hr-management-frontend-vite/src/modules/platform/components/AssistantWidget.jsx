import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, X, Maximize2 } from 'lucide-react';
import { useT } from '@/lib/i18n';
import AssistantChat from './AssistantChat';

/** Floating "Ask HR assistant" button + chat panel shown inside the app shell. */
const AssistantWidget = ({ isAdmin = false }) => {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <div
          className="fixed z-50 inset-x-2 bottom-2 top-16 sm:inset-auto sm:right-4 sm:bottom-20 sm:w-[380px] sm:h-[560px] flex flex-col rounded-2xl bg-slate-50 border border-slate-200 shadow-2xl overflow-hidden"
          role="dialog"
          aria-label={t('AI Assistant')}
        >
          <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-yellow-400" />
              <span className="font-semibold text-sm">{t('AI Assistant')}</span>
            </div>
            <div className="flex items-center gap-1">
              <Link to="/assistant" onClick={() => setOpen(false)} className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800" aria-label="Open full page" title="Open full page">
                <Maximize2 className="w-4 h-4" />
              </Link>
              <button type="button" onClick={() => setOpen(false)} className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800" aria-label={t('Close')}>
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <AssistantChat compact isAdmin={isAdmin} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`fixed z-40 right-4 bottom-4 sm:bottom-4 ${open ? 'hidden sm:flex' : 'flex'} items-center gap-2 rounded-full bg-slate-900 text-white shadow-xl px-4 py-3 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-yellow-400`}
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        aria-expanded={open}
        data-testid="assistant-widget-btn"
      >
        <Bot className="w-5 h-5 text-yellow-400" />
        <span className="text-sm font-medium hidden sm:inline">{t('Ask HR assistant')}</span>
      </button>
    </>
  );
};

export default AssistantWidget;
