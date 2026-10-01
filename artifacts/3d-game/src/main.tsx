import { createRoot } from 'react-dom/client';

import App from './App';

// Self-hosted web fonts (bundled from @fontsource, served from this origin): the game makes no
// third-party requests. Same families and weights the old Google Fonts link loaded.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
