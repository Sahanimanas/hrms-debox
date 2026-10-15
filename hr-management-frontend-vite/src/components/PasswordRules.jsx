import React from 'react';
import { Check, X, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PASSWORD_RULES, PASSWORD_MAX_LENGTH } from '@/lib/password';

/**
 * Live checklist of the password rules under a new-password field.
 * Rules start neutral; once the user has typed (or `showErrors` is set after a submit attempt)
 * met rules turn green and unmet ones red.
 */
const PasswordRules = ({ password = '', showErrors = false, className, id }) => {
  const pw = String(password);
  const started = pw.length > 0 || showErrors;
  const tooLong = pw.length > PASSWORD_MAX_LENGTH;
  return (
    <ul id={id} aria-live="polite" className={cn('grid gap-1 sm:grid-cols-2 text-xs leading-4', className)}>
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(pw);
        const Icon = !started ? Circle : ok ? Check : X;
        return (
          <li
            key={rule.id}
            className={cn('flex items-center gap-1.5', !started ? 'text-ink-muted' : ok ? 'text-success-fg' : 'text-danger-fg')}
          >
            <Icon className={cn('shrink-0', started ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5 mx-0.5')} aria-hidden="true" />
            <span>{rule.label}</span>
            <span className="sr-only">{!started ? '' : ok ? '(met)' : '(not met)'}</span>
          </li>
        );
      })}
      {tooLong && (
        <li className="flex items-center gap-1.5 text-danger-fg">
          <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>At most {PASSWORD_MAX_LENGTH} characters</span>
        </li>
      )}
    </ul>
  );
};

export default PasswordRules;
