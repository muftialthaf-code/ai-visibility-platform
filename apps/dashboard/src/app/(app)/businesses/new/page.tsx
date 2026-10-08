import { ActionForm } from '@/components/ActionForm';
import { requireUser } from '@/lib/auth';
import { addBusinessAction } from '../actions';

export default async function NewBusinessPage() {
  await requireUser('tenants:lifecycle');
  return (
    <>
      <h1>Add a business</h1>
      <p className="muted">Step 1 of 2. This creates the business as <strong>paused</strong> from the blank template. Step 2 is a guided checklist where you fill in the details, then launch it.</p>
      <div className="card" style={{ maxWidth: '36rem' }}>
        <ActionForm action={addBusinessAction} submit="Create and continue">
          <label htmlFor="name">Business name</label>
          <input id="name" name="name" type="text" required />
          <label htmlFor="id">Short id <span className="hint">(lowercase letters, numbers, hyphens. Leave blank to generate from the name. Cannot be changed later.)</span></label>
          <input id="id" name="id" type="text" pattern="[a-z0-9]+(-[a-z0-9]+)*" />
          <label htmlFor="domain">Domain <span className="hint">(for example example.com, without https://)</span></label>
          <input id="domain" name="domain" type="text" required />
          <fieldset style={{ border: 0, padding: 0 }}>
            <legend style={{ fontWeight: 600, margin: '.8rem 0 .25rem' }}>Languages</legend>
            <label style={{ fontWeight: 500 }}><input type="checkbox" name="languages" value="en" defaultChecked /> English</label>
            <label style={{ fontWeight: 500 }}><input type="checkbox" name="languages" value="ar" defaultChecked /> Arabic (right-to-left)</label>
          </fieldset>
          <label htmlFor="extraLanguages">Other language codes <span className="hint">(optional, separated by commas, for example fr, ur)</span></label>
          <input id="extraLanguages" name="extraLanguages" type="text" />
          <label htmlFor="defaultLanguage">Default language <span className="hint">(served at the site root)</span></label>
          <input id="defaultLanguage" name="defaultLanguage" type="text" defaultValue="en" />
        </ActionForm>
      </div>
    </>
  );
}
