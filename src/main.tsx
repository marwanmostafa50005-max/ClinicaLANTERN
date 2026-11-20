import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
// The handwriting font for the pharmacist's name under a letter, bundled with the page so it needs
// no internet. It is the last choice in --hand, after the handwriting fonts of this computer.
import '@fontsource/caveat/latin-700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/hero.css';
import './styles/icons.css';
import './styles/models.css';
import './styles/panels.css';
import './styles/letters.css';
import './styles/print.css';
import './styles/replay.css';

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
