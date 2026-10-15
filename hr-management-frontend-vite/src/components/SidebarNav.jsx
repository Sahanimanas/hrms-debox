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
    <div className="flex flex-col gap-1">
      {groups.map(({ section, items: sectionItems }) => {
        const containsActive = sectionItems.some(i => isActive(i.href));
        const open = section === 'Overview' || containsActive || !collapsed.has(section);
        return (
          <div key={section} className="flex flex-col gap-0.5">
            {section !== 'Overview' && (
              <button
                type="button"
                onClick={() => toggle(section)}
                className="w-full flex items-center justify-between px-3 pt-2.5 pb-1.5 text-[11px] leading-[14px] font-semibold uppercase tracking-[0.06em] text-navy-text/75 hover:text-white"
                aria-expanded={open}
              >
                {t(section)}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
              </button>
            )}
            {open && (
              <div className="flex flex-col gap-0.5">
                {sectionItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      onClick={onNavigate}
                      data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                      className={`flex items-center gap-3 px-3 ${compact ? 'h-10' : 'h-11'} text-sm leading-5 rounded-md transition-colors ${active
                        ? 'bg-brand text-brand-on font-semibold'
                        : 'text-navy-text font-medium hover:bg-navy-hover hover:text-white'
                        }`}
                    >
                      <Icon className="w-[18px] h-[18px] flex-shrink-0" />
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
