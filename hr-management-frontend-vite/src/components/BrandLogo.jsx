import React from 'react';

export const BRAND_NAME = 'Xeno-HR';

const SIZES = {
  sm: { mark: 'w-7 h-7 text-sm', text: 'text-lg' },
  md: { mark: 'w-8 h-8 text-lg', text: 'text-lg' },
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
      <div className={`${s.mark} rounded-md bg-brand text-brand-on font-display font-extrabold flex items-center justify-center`}>
        X
      </div>
      <span className={`${s.text} font-display font-semibold tracking-[-0.01em] ${tone === 'light' ? 'text-white' : 'text-ink'}`}>
        Xeno<span className={tone === 'light' ? 'text-brand' : 'text-brand-text'}>-{p.suffix}</span>
      </span>
    </div>
  );
};

export default BrandLogo;
