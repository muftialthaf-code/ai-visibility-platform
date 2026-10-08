'use client';
import { Messages, SubmitButton, useServerForm } from '@/components/ActionForm';
import { bulkApproveAction } from './actions';

export interface Row {
  pr: number;
  tenantId: string;
  title: string;
  topic: string;
  languages: string[];
  risk: number;
  passed: boolean;
  failing: number;
  age: string;
  changesRequested: boolean;
}

/** The queue as one form: tick the drafts whose checks all passed and publish them together. */
export function QueueTable({ rows }: { rows: Row[] }) {
  const { state, pending, ref, formAction } = useServerForm(bulkApproveAction);
  return (
    <form ref={ref} action={formAction}>
      <div className="card tablewrap">
        <table>
          <thead><tr><th aria-label="Select" /><th>Draft</th><th>Business</th><th>Checks</th><th>Risk</th><th>Waiting</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pr}>
                <td>{r.passed ? <input type="checkbox" name="pr" value={r.pr} aria-label={`Select draft ${r.pr}`} /> : null}</td>
                <td><a href={`/review/${r.pr}`}>{r.title}</a><div className="muted small">{r.topic} · {r.languages.join(', ')}</div></td>
                <td>{r.tenantId}</td>
                <td>
                  <span className={`badge ${r.changesRequested ? 'warn' : r.passed ? 'ok' : 'bad'}`}>
                    {r.changesRequested ? 'changes requested' : r.passed ? 'all passed' : `${r.failing} failed`}
                  </span>
                </td>
                <td>{r.risk}</td>
                <td>{r.age}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Messages state={state} />
      <p><SubmitButton className="btn" pending={pending}>Publish selected</SubmitButton> <span className="muted small">Only drafts whose checks all passed can be selected. Open a draft to read it first.</span></p>
    </form>
  );
}
