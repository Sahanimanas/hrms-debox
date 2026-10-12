import React from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '@/components/BrandLogo';

/** Public shell for the careers site (no app chrome, no login). */
export default function CareersLayout({ companyName, children }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link to="/careers" className="focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 rounded-lg">
            <BrandLogo tone="dark" size="md" />
          </Link>
          <Link to="/careers" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Open positions
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>© {new Date().getFullYear()} {companyName || 'Xeno-HR'}. All rights reserved.</span>
          <span>We are an equal opportunity employer.</span>
        </div>
      </footer>
    </div>
  );
}
