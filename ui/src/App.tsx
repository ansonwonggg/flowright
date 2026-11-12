import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { duration } from './lib/format.ts';
import { useNow } from './lib/hooks.ts';
import { useLiveEvents } from './live.ts';
import { EnvPicker } from './components/EnvPicker.tsx';
import { useLive, useMeta } from './queries.ts';

const LivePill = () => {
  const { data: live } = useLive();
  const now = useNow(Boolean(live));
  if (!live) return null;
  return (
    <Link className="pill running live-pill" to={`/run/${live.id}`}>
      <span className="spin">◐</span> {live.title} · {duration(now - live.startedAt)}
    </Link>
  );
};

/** The page frame: top bar with navigation and the running-run pill, and the live event stream. */
export const App = () => {
  const connected = useLiveEvents();
  const { data: meta } = useMeta();
  const title = meta?.settings.title ?? 'flowright';
  useEffect(() => {
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);
  const { pathname } = useLocation();
  const homeActive = pathname === '/' || pathname.startsWith('/fn/');
  const flowsActive = pathname.startsWith('/flow');
  const historyActive = pathname.startsWith('/history') || pathname.startsWith('/run/');
  return (
    <>
      <header>
        <Link className="brand" to="/">
          <span className="logo" aria-hidden="true">
            ◆
          </span>
          {title}
        </Link>
        <nav>
          <NavLink to="/" className={homeActive ? 'on' : ''}>
            Functions
          </NavLink>
          <NavLink to="/flows" className={flowsActive ? 'on' : ''}>
            Flows
          </NavLink>
          <NavLink to="/history" className={historyActive ? 'on' : ''}>
            History
          </NavLink>
          <NavLink to="/records" className={({ isActive }) => (isActive ? 'on' : '')}>
            Records
          </NavLink>
          <NavLink to="/environments" className={({ isActive }) => (isActive ? 'on' : '')}>
            Environments
          </NavLink>
        </nav>
        <span className="spacer" />
        <EnvPicker />
        <LivePill />
        {!connected && <span className="offline">Lost the app server, retrying… (is flowright app still running?)</span>}
      </header>
      <main className="wrap">
        <Outlet />
      </main>
    </>
  );
};
