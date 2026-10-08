'use client';
export function PrintButton() {
  return <button className="btn secondary noprint" type="button" onClick={() => window.print()}>Print or save as PDF</button>;
}
