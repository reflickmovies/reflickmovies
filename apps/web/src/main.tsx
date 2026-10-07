import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme } from './theme';
import './styles/globals.css';

/**
 * Bootstrap.
 *
 * The theme tokens are written onto the document root synchronously, before the
 * first render, so the very first paint already has the palette. Loading them
 * through a context instead would mean a frame of unstyled content.
 */
applyTheme();

const container = document.getElementById('root');

if (!container) {
  throw new Error('index.html is missing the #root element.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);