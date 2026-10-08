'use client';
import { useEffect, useState } from 'react';

/** Shows the success message carried across a page reload in ?notice=, then removes it from the address bar. */
export function Notice() {
  const [text, setText] = useState('');
  useEffect(() => {
    const url = new URL(window.location.href);
    const notice = url.searchParams.get('notice');
    if (!notice) return;
    setText(notice);
    url.searchParams.delete('notice');
    window.history.replaceState(null, '', url.toString());
  }, []);
  return text ? <p role="status" className="alert ok">{text}</p> : null;
}
