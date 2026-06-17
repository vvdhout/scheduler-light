import { render } from 'preact';
import { Create } from './pages/Create';
import { View } from './pages/View';
import './styles.css';

// Kill all zoom app-wide: Safari pinch gestures and any multi-touch pinch.
// (Double-tap zoom is handled by touch-action in CSS.)
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(t, (e) => e.preventDefault());
}
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

function App() {
  // /s/:id (and legacy /a/:id) open the shared page; ownership is decided by
  // this device (lib/store), so there's no separate admin route.
  const m = location.pathname.match(/^\/(?:s|a)\/([A-Za-z0-9]{10,40})$/);
  if (m) return <View id={m[1]!} />;
  return <Create />;
}

render(<App />, document.getElementById('app')!);
