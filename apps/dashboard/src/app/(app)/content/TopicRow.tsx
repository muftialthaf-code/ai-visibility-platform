'use client';
import { useServerForm } from '@/components/ActionForm';
import { topicAction } from './actions';

export function TopicRow({ id, tenant, status }: { id: string; tenant: string; status: string }) {
  const { state, ref, formAction, pending } = useServerForm(topicAction);
  const ops = [
    status !== 'approved' && status !== 'used' ? ['approved', 'Approve'] : null,
    status !== 'rejected' && status !== 'used' ? ['rejected', 'Reject'] : null,
    ['delete', 'Delete'],
  ].filter(Boolean) as string[][];
  return (
    <form ref={ref} action={formAction} className="row">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="tenant" value={tenant} />
      <select name="op" aria-label="Action" defaultValue={ops[0]![0]} style={{ width: '7.5rem' }}>
        {ops.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <button className="btn secondary" type="submit" disabled={pending}>Apply</button>
      {state.error && <span role="alert" className="error small">{state.error}</span>}
    </form>
  );
}
