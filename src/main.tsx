import { render } from 'preact';
import { Create } from './pages/Create';
import { View } from './pages/View';
import './styles.css';

function App() {
  // /s/:id (and legacy /a/:id) open the shared page; ownership is decided by
  // this device (lib/store), so there's no separate admin route.
  const m = location.pathname.match(/^\/(?:s|a)\/([A-Za-z0-9]{10,40})$/);
  if (m) return <View id={m[1]!} />;
  return <Create />;
}

render(<App />, document.getElementById('app')!);
