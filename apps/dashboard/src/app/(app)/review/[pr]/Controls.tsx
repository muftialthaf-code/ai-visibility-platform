'use client';
import { ActionForm } from '@/components/ActionForm';
import { approveAction, editAction, rejectAction, requestChangesAction, scheduleAction } from '../actions';

export function ApproveForm({ pr, passed }: { pr: number; passed: boolean }) {
  return (
    <ActionForm action={approveAction} submit="Approve and publish">
      <input type="hidden" name="pr" value={pr} />
      {!passed && <label><input type="checkbox" name="override" style={{ width: 'auto', marginRight: '.4rem' }} />Publish even though required checks failed</label>}
    </ActionForm>
  );
}

export function ScheduleForm({ pr, passed }: { pr: number; passed: boolean }) {
  return (
    <ActionForm action={scheduleAction} submit="Schedule" submitClass="btn secondary">
      <input type="hidden" name="pr" value={pr} />
      <label htmlFor="publishAt">Publish at (UTC)</label>
      <input id="publishAt" name="publishAt" type="datetime-local" required />
      {!passed && <label><input type="checkbox" name="override" style={{ width: 'auto', marginRight: '.4rem' }} />Schedule even though required checks failed</label>}
    </ActionForm>
  );
}

export function ChangesForm({ pr }: { pr: number }) {
  return (
    <ActionForm action={requestChangesAction} submit="Ask the agent to rewrite" submitClass="btn secondary">
      <input type="hidden" name="pr" value={pr} />
      <label htmlFor="instructions">What should change?</label>
      <textarea id="instructions" name="instructions" required placeholder="For example: make the opening shorter, and add a section on cost." />
    </ActionForm>
  );
}

export function RejectForm({ pr }: { pr: number }) {
  return (
    <ActionForm action={rejectAction} submit="Reject" submitClass="btn danger">
      <input type="hidden" name="pr" value={pr} />
      <label htmlFor="reason">Why? (the agent learns from this)</label>
      <input id="reason" name="reason" type="text" required placeholder="For example: off-brand topic" />
    </ActionForm>
  );
}

export function EditForm({ pr, langs }: { pr: number; langs: Array<{ lang: string; title: string; description: string; body: string }> }) {
  return (
    <ActionForm action={editAction} submit="Save edits" submitClass="btn secondary">
      <input type="hidden" name="pr" value={pr} />
      {langs.map((l) => (
        <fieldset key={l.lang} style={{ border: '1px solid var(--line)', borderRadius: 8, margin: '.6rem 0' }}>
          <legend>{l.lang}</legend>
          <label htmlFor={`title:${l.lang}`}>Title</label>
          <input id={`title:${l.lang}`} name={`title:${l.lang}`} type="text" defaultValue={l.title} dir="auto" />
          <label htmlFor={`description:${l.lang}`}>Meta description</label>
          <textarea id={`description:${l.lang}`} name={`description:${l.lang}`} defaultValue={l.description} dir="auto" style={{ minHeight: '3.5rem' }} />
          <label htmlFor={`body:${l.lang}`}>Article (Markdown)</label>
          <textarea id={`body:${l.lang}`} name={`body:${l.lang}`} defaultValue={l.body} dir="auto" style={{ minHeight: '22rem', fontFamily: 'ui-monospace, Menlo, monospace' }} />
        </fieldset>
      ))}
    </ActionForm>
  );
}
