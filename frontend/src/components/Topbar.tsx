export function Topbar({ active }: { active: 'backbone' | 'rooms' }) {
  return (
    <header className="topbar">
      <a className="brand" href="#/backbone">
        <span className="brand-mark" />
        Local network check
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
