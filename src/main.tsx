import { render } from 'preact';
import { Admin } from './pages/Admin';
import { Create } from './pages/Create';
import { View } from './pages/View';
import './styles.css';

function App() {
  const m = location.pathname.match(/^\/(s|a)\/([A-Za-z0-9]{10,40})$/);
  if (m) return m[1] === 's' ? <View id={m[2]!} /> : <Admin id={m[2]!} />;
  return <Create />;
}

render(<App />, document.getElementById('app')!);
