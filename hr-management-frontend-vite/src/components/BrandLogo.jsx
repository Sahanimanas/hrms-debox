import React from 'react';

export const BRAND_NAME = 'Xeno-HR';

const SIZES = {
  sm: { mark: 'w-7 h-7 text-sm', text: 'text-lg' },
  md: { mark: 'w-8 h-8 text-base', text: 'text-xl' },
  lg: { mark: 'w-11 h-11 text-xl', text: 'text-3xl' },
};

// Wordmark suffix per product (see src/lib/workspace.js)
const PRODUCTS = {
  hr: { suffix: 'HR', label: 'Xeno-HR' },
  pm: { suffix: 'PM', label: 'Xeno-PM' },
};

/**
 * Text wordmark for the product.
 * tone="light" for dark backgrounds (sidebar, footer), "dark" for white ones.
 * product="hr" (default) or "pm" for Xeno Project Management.
 */
const BrandLogo = ({ size = 'md', tone = 'light', product = 'hr', className = '' }) => {
  const s = SIZES[size] || SIZES.md;
  const p = PRODUCTS[product] || PRODUCTS.hr;
  return (
    <div className={`flex items-center gap-2 select-none ${className}`} aria-label={p.label}>
      <div className={`${s.mark} rounded-lg bg-yellow-400 text-slate-900 font-extrabold flex items-center justify-center`}>
        X
      </div>
      <span
        className={`${s.text} font-extrabold tracking-tight ${tone === 'light' ? 'text-white' : 'text-slate-900'}`}
        style={{ fontFamily: 'Plus Jakarta Sans' }}
      >
        Xeno<span className="text-yellow-400">-{p.suffix}</span>
      </span>
    </div>
  );
};

export default BrandLogo;
