import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './timeline-controls.css';
import './timeline-cursors.css';
import './universal-tracks.css';
import './workspace-layout.css';
createRoot(document.getElementById('root')!).render(<App />);
