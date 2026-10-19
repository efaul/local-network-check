import { useHashRoute } from './router';
import { Topbar } from './components/Topbar';
import { BackboneView } from './components/BackboneView';
import { RoomsView } from './components/RoomsView';
import { RoomDetailView } from './components/RoomDetailView';

export function App() {
  const route = useHashRoute();

  return (
    <>
      <Topbar active={route.section} />
      <main className="page">
        {route.section === 'rooms' ? (
          route.roomLocation !== null ? (
            <RoomDetailView key={route.roomLocation} location={route.roomLocation} />
          ) : (
            <RoomsView />
          )
        ) : (
          <BackboneView />
        )}
      </main>
    </>
  );
}
