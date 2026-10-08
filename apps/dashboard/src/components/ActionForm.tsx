'use client';
import { useActionState, useEffect, useRef } from 'react';

export interface FormState {
  ok?: string;
  error?: string;
  issues?: Array<{ path: string; message: string }>;
  needsCode?: boolean;
  /** Where to go next. The browser loads that page afresh (full navigation). */
  redirect?: string;
  /** Reload this page so lists and badges show the change, carrying the success message across. */
  reload?: boolean;
}

export function SubmitButton({ children, className = 'btn', pending }: { children: React.ReactNode; className?: string; pending: boolean }) {
  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? 'Working…' : children}
    </button>
  );
}

export function Messages({ state }: { state: FormState }) {
  return (
    <>
      {state.error && <p role="alert" className="error">{state.error}</p>}
      {state.issues && state.issues.length > 0 && (
        <ul role="alert" className="error">
          {state.issues.map((i, n) => (
            <li key={n}>{i.path ? <code>{i.path}</code> : null} {i.message}</li>
          ))}
        </ul>
      )}
      {state.ok && <p role="status" className="success">{state.ok}</p>}
    </>
  );
}

/**
 * Submit a form to a server action using React's own form action handling (which Next needs for
 * redirects), then put back what the person typed, because React clears the fields after every
 * action. Fields named in `clearOnError` (passwords, codes) stay empty after a failure.
 */
export function useServerForm(action: (prev: FormState, data: FormData) => Promise<FormState>, clearOnError: string[] = []) {
  const [state, run, pending] = useActionState(action, {} as FormState);
  const ref = useRef<HTMLFormElement>(null);
  const submitted = useRef<FormData | null>(null);

  // Full-page navigation keeps this admin app simple and reliable: no client router state to get out of step.
  useEffect(() => {
    if (state.redirect) {
      window.location.assign(state.redirect);
    } else if (state.reload && state.ok) {
      const url = new URL(window.location.href);
      url.searchParams.set('notice', state.ok);
      window.location.assign(url.toString());
    }
  }, [state]);

  useEffect(() => {
    const form = ref.current;
    const data = submitted.current;
    if (!form || !data) return;
    for (const el of Array.from(form.elements)) {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) || !el.name) continue;
      if (state.error && clearOnError.includes(el.name)) {
        el.value = '';
      } else if (el instanceof HTMLInputElement && el.type === 'checkbox') {
        el.checked = data.has(el.name);
      } else if (!(el instanceof HTMLInputElement && (el.type === 'hidden' || el.type === 'submit'))) {
        const v = data.get(el.name);
        if (typeof v === 'string') el.value = v;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const formAction = (data: FormData) => {
    submitted.current = data;
    run(data);
  };
  return { state, pending, ref, formAction };
}

/** A form wired to a server action that shows validation messages and a pending state. */
export function ActionForm({
  action,
  children,
  submit = 'Save',
  submitClass,
  className,
  clearOnError,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  children: React.ReactNode;
  submit?: string;
  submitClass?: string;
  className?: string;
  clearOnError?: string[];
}) {
  const { state, pending, ref, formAction } = useServerForm(action, clearOnError);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <Messages state={state} />
      <p><SubmitButton className={submitClass ?? 'btn'} pending={pending}>{submit}</SubmitButton></p>
    </form>
  );
}
