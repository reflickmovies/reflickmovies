import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './components/shell/AppShell';
import { ThemeModeProvider } from './components/shell/ThemeMode';
import { ToastProvider } from './components/ui';
import { CataloguePage } from './pages/CataloguePage';
import { ExplorePage } from './pages/ExplorePage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage, RouteErrorPage } from './pages/NotFoundPage';
import { RecommendedPage } from './pages/RecommendedPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { TitlePage } from './pages/TitlePage';
import { WatchPage } from './pages/WatchPage';

/**
 * Routes.
 *
 * Two families, and keeping them apart is what stops a film and a series that share a slug
 * from colliding: `/film/:slug` and `/series/:slug` for detail, `/films` and `/series` for
 * the grids. The server produces the detail paths (`catalog.service` sets `path` on every
 * summary) and `lib/routes` builds the ones it does not.
 *
 * Everything under `AppShell` renders content only; the rail, header and search live in the
 * shell, which is why navigating does not rebuild the navigation or reset the search field.
 *
 * `/watch` used to sit outside that as a sibling route, on the grounds that the player brings its
 * own bar and wants the whole viewport. In practice it cost more than it bought: being outside the
 * shell put it beyond `AppShell.module.css`, so the `--lp-*` palette it reads was never defined
 * and the page fell back to a fixed dark one - pressing play threw a light-mode reader onto a black
 * screen, which reads as the app failing rather than as a different page. It also meant a second
 * hand-built bar, a second back button and a second set of responsive rules to keep in step with
 * the first. It is a normal route now, and the one thing it genuinely needs from outside - a
 * viewport-wide frame - is satisfied by the frame itself, which is already 16:9 and edge to edge
 * within the shell's scrollport.
 *
 * `ThemeModeProvider` is above the router because the shell reads it, and `ToastProvider` is
 * above the error boundary so a failure inside a page can still report itself.
 */
export function App() {
  return (
    <ToastProvider>
      <ThemeModeProvider>
        <ErrorBoundary fallback={(error) => <RouteErrorPage error={error} />}>
          <BrowserRouter>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<HomePage />} />

                {/* Discovery */}
                <Route path="explore" element={<ExplorePage />} />
                <Route path="popular" element={<CataloguePage kind="popular" />} />

                {/* Catalogue */}
                <Route path="films" element={<CataloguePage kind="films" />} />
                <Route path="series" element={<CataloguePage kind="series" />} />

                {/* Detail and search */}
                <Route path="film/:slug" element={<TitlePage type="movie" />} />
                <Route path="series/:slug" element={<TitlePage type="tv" />} />
                <Route path="search" element={<SearchPage />} />

                {/* Local preferences */}
                <Route path="recommended" element={<RecommendedPage />} />
                <Route path="settings" element={<SettingsPage />} />

                {/* Playback */}
                <Route path="watch/film/:slug" element={<WatchPage type="movie" />} />
                <Route path="watch/series/:slug" element={<WatchPage type="tv" />} />

                {/* Unknown addresses still get the shell, so a wrong URL is not a dead end. */}
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ErrorBoundary>
      </ThemeModeProvider>
    </ToastProvider>
  );
}