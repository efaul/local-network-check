export function Topbar({ active }: { active: 'backbone' | 'rooms' }) {
  return (
    <header className="topbar">
      <a className="brand" href="#/backbone">
        <svg className="brand-mark" viewBox="0 0 32 32" role="img" aria-label="Netty">
          <defs>
            <linearGradient id="netty-bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--accent)" />
              <stop offset="100%" stopColor="var(--accent-2)" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="9" fill="url(#netty-bg)" />
          <g stroke="#0b0f16" strokeWidth="1.6" strokeLinecap="round">
            <line x1="16" y1="10" x2="10" y2="21" />
            <line x1="16" y1="10" x2="22" y2="21" />
            <line x1="10" y1="21" x2="22" y2="21" />
          </g>
          <circle cx="16" cy="10" r="3.4" fill="#fff" />
          <circle cx="10" cy="21" r="3.4" fill="#fff" />
          <circle cx="22" cy="21" r="3.4" fill="#fff" />
        </svg>
        Netty
      </a>
      <nav className="nav">
        <a href="#/backbone" data-active={active === 'backbone'}>
          Backbone
        </a>
        <a href="#/rooms" data-active={active === 'rooms'}>
          Rooms
        </a>
      </nav>
    </header>
  );
}
