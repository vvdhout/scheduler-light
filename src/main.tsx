import { render } from 'preact';
import { Create } from './pages/Create';
import { Stats } from './pages/Stats';
import { View } from './pages/View';
import { track } from './lib/metrics';
import { ownerToken } from './lib/store';
import './styles.css';

// Kill all zoom app-wide: Safari pinch gestures and any multi-touch pinch.
// (Double-tap zoom is handled by touch-action in CSS.)
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(t, (e) => e.preventDefault());
}
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

const linkMatch = location.pathname.match(/^\/(?:s|a)\/([A-Za-z0-9]{10,40})$/);

function App() {
  // /s/:id (and legacy /a/:id) open the shared page; ownership is decided by
  // this device (lib/store), so there's no separate admin route.
  if (location.pathname === '/stats') return <Stats />;
  if (linkMatch) return <View id={linkMatch[1]!} />;
  return <Create />;
}

render(<App />, document.getElementById('app')!);

// Anonymous page-open metric (once per load; not on the stats dashboard).
if (location.pathname !== '/stats') {
  if (linkMatch) track('link', ownerToken(linkMatch[1]!) != null);
  else track('home');
}
