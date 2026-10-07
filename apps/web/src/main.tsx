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

/*
 * A mirrored embed still runs third-party code, and the browser lets a cross-origin frame call
 * methods on the parent window - `window.top.open(...)` is reachable from inside the frame, so
 * freezing `window.open` inside the frame alone would leave that door open. Reflick never opens a
 * window itself, so the parent freezes it too, before any frame exists to call it. The popup it
 * just blocked is reported as an event so the watch page can surface it as a toast.
 */
window.open = () => {
  window.dispatchEvent(new CustomEvent('reflick:popup-blocked'));
  return null;
};

const container = document.getElementById('root');

if (!container) {
  throw new Error('index.html is missing the #root element.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);