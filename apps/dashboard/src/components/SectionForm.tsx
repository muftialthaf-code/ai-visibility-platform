import { fname, getByPath, lname, rname, type Column, type Field, type Section } from '@/lib/sections';

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', ar: 'Arabic (العربية)', fr: 'French', es: 'Spanish', ur: 'Urdu', de: 'German' };
const RTL = new Set(['ar', 'he', 'fa', 'ur']);
const langLabel = (l: string) => LANGUAGE_NAMES[l] ?? l;
const dirOf = (l: string) => (RTL.has(l.split('-')[0]!) ? 'rtl' : 'ltr');

function Hint({ text }: { text?: string }) {
  return text ? <span className="hint"> {text}</span> : null;
}

function LocalizedInputs({ name, label, hint, values, languages, long, lines }: { name: (l: string) => string; label: string; hint?: string; values: any; languages: string[]; long?: boolean; lines?: boolean }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ fontWeight: 600, margin: '.8rem 0 .25rem' }}>
        {label}
        <Hint text={hint} />
      </legend>
      <div className="pair">
        {languages.map((l) => {
          const raw = values?.[l];
          const value = lines ? (Array.isArray(raw) ? raw.join('\n') : '') : (raw ?? '');
          return (
            <div key={l}>
              <label htmlFor={name(l)} className="small muted" style={{ margin: '0 0 .15rem' }}>{langLabel(l)}</label>
              {long || lines ? (
                <textarea id={name(l)} name={name(l)} defaultValue={value} dir={dirOf(l)} lang={l} />
              ) : (
                <input id={name(l)} name={name(l)} type="text" defaultValue={value} dir={dirOf(l)} lang={l} />
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function RowsEditor({ field, current, languages }: { field: Extract<Field, { kind: 'rows' }>; current: any; languages: string[] }) {
  const existing: any[] = Array.isArray(current) ? current : [];
  const total = existing.length + (field.blank ?? 2);
  return (
    <div>
      <p style={{ fontWeight: 600, margin: '.8rem 0 .25rem' }}>
        {field.label}
        <Hint text={field.hint} />
      </p>
      <p className="small muted">Clear every field in a row to remove it. Use the empty rows at the end to add more.</p>
      <input type="hidden" name={`n:${field.path}`} value={total} />
      {Array.from({ length: total }, (_, i) => {
        const row = existing[i] ?? {};
        return (
          <div className="card" key={i}>
            <strong className="small muted">#{i + 1}{i >= existing.length ? ' (new)' : ''}</strong>
            {field.columns.map((c: Column) => {
              if (c.kind === 'slug') {
                return (
                  <div key={c.key}>
                    <label htmlFor={rname(field.path, i, c.key)}>{c.label} <span className="hint">(leave blank to generate)</span></label>
                    <input id={rname(field.path, i, c.key)} name={rname(field.path, i, c.key)} type="text" defaultValue={row[c.key] ?? ''} />
                  </div>
                );
              }
              if (c.kind === 'text' || c.kind === 'textarea') {
                return (
                  <div key={c.key}>
                    <label htmlFor={rname(field.path, i, c.key)}>{c.label}</label>
                    <input id={rname(field.path, i, c.key)} name={rname(field.path, i, c.key)} type="text" defaultValue={row[c.key] ?? ''} />
                  </div>
                );
              }
              return (
                <LocalizedInputs
                  key={c.key}
                  name={(l) => rname(field.path, i, c.key, l)}
                  label={c.label}
                  values={row[c.key]}
                  languages={languages}
                  long={c.kind === 'localizedText'}
                  lines={c.kind === 'localizedLines'}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function FieldInput({ field, tenant, languages }: { field: Field; tenant: unknown; languages: string[] }) {
  const current = getByPath(tenant, field.path);
  const id = fname(field.path);
  switch (field.kind) {
    case 'text':
    case 'color':
    case 'url':
    case 'email':
      return (
        <div>
          <label htmlFor={id}>{field.label}<Hint text={field.hint} /></label>
          <input id={id} name={id} type={field.kind === 'color' ? 'text' : field.kind} defaultValue={current ?? ''} required={'required' in field && field.required} {...(field.kind === 'color' ? { pattern: '#[0-9a-fA-F]{6}', placeholder: '#0a6b5a' } : {})} />
        </div>
      );
    case 'textarea':
      return (
        <div>
          <label htmlFor={id}>{field.label}<Hint text={field.hint} /></label>
          <textarea id={id} name={id} defaultValue={current ?? ''} />
        </div>
      );
    case 'number':
      return (
        <div>
          <label htmlFor={id}>{field.label}<Hint text={field.hint} /></label>
          <input id={id} name={id} type="number" defaultValue={current ?? ''} min={field.min} max={field.max} step={field.step} />
        </div>
      );
    case 'select':
      return (
        <div>
          <label htmlFor={id}>{field.label}<Hint text={field.hint} /></label>
          <select id={id} name={id} defaultValue={current ?? ''}>
            {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      );
    case 'bool':
      return (
        <div>
          <label htmlFor={id} style={{ fontWeight: 500 }}>
            <input id={id} name={id} type="checkbox" defaultChecked={Boolean(current)} />
            {field.label}<Hint text={field.hint} />
          </label>
        </div>
      );
    case 'lines':
      return (
        <div>
          <label htmlFor={id}>{field.label}<Hint text={field.hint} /></label>
          <textarea id={id} name={id} defaultValue={Array.isArray(current) ? current.join('\n') : ''} />
        </div>
      );
    case 'localized':
      return <LocalizedInputs name={(l) => lname(field.path, l)} label={field.label} hint={field.hint} values={current} languages={languages} long={field.long} />;
    case 'localizedLines':
      return <LocalizedInputs name={(l) => lname(field.path, l)} label={field.label} hint={field.hint} values={current} languages={languages} lines />;
    case 'rows':
      return <RowsEditor field={field} current={current} languages={languages} />;
  }
}

/** Renders every field of a section, prefilled from the tenant's current config. Lives inside an ActionForm. */
export function SectionFields({ section, tenant, languages }: { section: Section; tenant: unknown; languages: string[] }) {
  return (
    <>
      {section.intro && <p className="muted">{section.intro}</p>}
      {section.fields.map((f) => <FieldInput key={f.path} field={f} tenant={tenant} languages={languages} />)}
    </>
  );
}
