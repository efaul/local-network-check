import { useEffect, useState } from 'react';

export interface Route {
  readonly section: 'backbone' | 'rooms';
  readonly roomLocation: string | null;
}

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [section, ...rest] = hash.split('/');

  if (section === 'rooms') {
    const encoded = rest[0];
    return { section: 'rooms', roomLocation: encoded !== undefined && encoded !== '' ? decodeURIComponent(encoded) : null };
  }

  return { section: 'backbone', roomLocation: null };
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    if (window.location.hash === '') window.location.hash = '#/backbone';
    const onChange = (): void => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function roomLink(location: string): string {
  return `#/rooms/${encodeURIComponent(location)}`;
}
