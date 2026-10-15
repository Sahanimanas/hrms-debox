import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COUNTRIES, DEFAULT_COUNTRY, getCountry, parsePhone, formatPhone, phoneError, digitsOnly } from '@/lib/phone';

/**
 * Phone field: country-code picker + national number.
 * - The number box only accepts digits and stops at the country's maximum length.
 * - Pasting "+44 7700 900123" switches the country automatically.
 * - The error shows after the field is left (or when `showError` is set, e.g. after a submit attempt),
 *   and the input carries a native validity message so <form> submits are blocked too.
 * hideErrorText: the parent renders the message itself (the red border still shows).
 * value / onChange use the stored format "+91 9876543210" ('' when empty).
 */
const PhoneInput = ({
  id,
  value,
  onChange,
  required = false,
  disabled = false,
  defaultCountry = DEFAULT_COUNTRY,
  showError = false,
  hideErrorText = false,
  className,
  boxClassName,
  inputClassName,
  'data-testid': testId,
}) => {
  const parsed = parsePhone(value, defaultCountry);
  // Keep the chosen country even while the number is empty (parsePhone can't know it then).
  const [iso, setIso] = useState(parsed.iso);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef(null);

  const country = getCountry(value ? parsed.iso : iso);
  const national = parsed.national;
  const error = phoneError(value, { required });
  const visibleError = (touched || showError) ? error : null;

  useEffect(() => {
    inputRef.current?.setCustomValidity(error || '');
  }, [error]);

  const emit = (nextIso, digits) => onChange?.(formatPhone(nextIso, digits.slice(0, getCountry(nextIso).max)));

  const onNumberChange = (e) => {
    const raw = e.target.value;
    if (raw.trim().startsWith('+')) {
      const p = parsePhone(raw, country.iso);
      setIso(p.iso);
      emit(p.iso, p.national);
      return;
    }
    emit(country.iso, digitsOnly(raw));
  };

  const onCountryChange = (e) => {
    const next = e.target.value;
    setIso(next);
    emit(next, national);
  };

  const lengthHint = country.min === country.max ? `${country.max}-digit number` : `${country.min}–${country.max} digits`;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div
        className={cn(
          'flex h-10 w-full overflow-hidden rounded-md border bg-surface shadow-xs transition-colors focus-within:ring-2 focus-within:ring-ring/60',
          visibleError ? 'border-danger-solid' : 'border-line focus-within:border-brand',
          disabled && 'opacity-50 cursor-not-allowed',
          boxClassName
        )}
      >
        <div className="relative w-[96px] shrink-0 border-r border-line">
          <select
            aria-label="Country code"
            value={country.iso}
            onChange={onCountryChange}
            disabled={disabled}
            className="h-full w-full appearance-none bg-transparent pl-3 pr-7 text-sm font-medium text-ink outline-none cursor-pointer disabled:cursor-not-allowed"
            data-testid={testId ? `${testId}-country` : undefined}
          >
            {COUNTRIES.map((c) => (
              <option key={c.iso} value={c.iso}>{`${c.iso} +${c.dial} — ${c.name}`}</option>
            ))}
          </select>
          {/* Closed state shows just "IN +91"; the long label is only for the open list. */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center gap-1 pl-3 pr-7 text-sm font-medium text-ink bg-subtle">
            <span className="text-ink-muted text-xs">{country.iso}</span> +{country.dial}
          </span>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
        </div>
        <input
          ref={inputRef}
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={national}
          onChange={onNumberChange}
          onBlur={() => setTouched(true)}
          maxLength={country.max}
          placeholder={lengthHint}
          required={required}
          disabled={disabled}
          aria-invalid={!!visibleError}
          aria-describedby={visibleError && id ? `${id}-error` : undefined}
          className={cn('min-w-0 flex-1 bg-transparent px-3 text-base md:text-sm text-ink tabular-nums placeholder:text-ink-muted outline-none disabled:cursor-not-allowed', inputClassName)}
          data-testid={testId}
        />
      </div>
      {visibleError && !hideErrorText && (
        <p id={id ? `${id}-error` : undefined} className="text-xs text-danger-fg">{visibleError}</p>
      )}
    </div>
  );
};

export default PhoneInput;
