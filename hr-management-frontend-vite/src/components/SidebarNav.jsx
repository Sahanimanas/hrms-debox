import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { NAV_SECTIONS } from '@/modules/registry';
import { useT } from '@/lib/i18n';

const STORAGE_KEY = 'nav-collapsed-sections';

const readCollapsed = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
  } catch {
    return new Set();
  }
};

/**
 * Sidebar links grouped into collapsible sections.
 * items: [{ name, href, icon, section }] already filtered for the user's role / permissions.
 * Section and item names are translated by their English label (src/lib/i18n).
 */
const SidebarNav = ({ items, isActive, onNavigate, compact = false }) => {
  const t = useT();
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggle = (section) => {
    const next = new Set(collapsed);
    if (next.has(section)) next.delete(section);
    else next.add(section);
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch { /* storage unavailable */ }
  };

  const groups = NAV_SECTIONS
    .map(section => ({ section, items: items.filter(i => (i.section || 'Overview') === section) }))
    .filter(g => g.items.length);

  return (
    <div className="space-y-4">
      {groups.map(({ section, items: sectionItems }) => {
        const containsActive = sectionItems.some(i => isActive(i.href));
        const open = section === 'Overview' || containsActive || !collapsed.has(section);
        return (
          <div key={section}>
            {section !== 'Overview' && (
              <button
                type="button"
                onClick={() => toggle(section)}
                className="w-full flex items-center justify-between px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300"
                aria-expanded={open}
              >
                {t(section)}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
              </button>
            )}
            {open && (
              <div className="space-y-0.5">
                {sectionItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      onClick={onNavigate}
                      data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                      className={`flex items-center px-3 ${compact ? 'py-2' : 'py-2.5'} text-sm font-medium rounded-lg transition-colors ${active
                        ? 'bg-yellow-400 text-slate-900'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-yellow-400'
                        }`}
                    >
                      <Icon className="w-[18px] h-[18px] mr-3 flex-shrink-0" />
                      <span className="truncate">{t(item.name)}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default SidebarNav;
