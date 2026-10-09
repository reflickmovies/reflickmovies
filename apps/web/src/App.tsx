import { lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './components/account/AuthProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './components/shell/AppShell';
import { ThemeModeProvider } from './components/shell/ThemeMode';
import { ToastProvider } from './components/ui';
import { HomePage } from './pages/HomePage';
import { NotFoundPage, RouteErrorPage } from './pages/NotFoundPage';

/*
 * Everything except the landing page and the catch-all loads on demand.
 *
 * `HomePage` stays eager because it is the first paint on every entry point, and `NotFoundPage`
 * stays eager because it is the fallback for anything - including a chunk that failed to load -
 * and a fallback that itself has to be fetched is not a fallback. The rest are the heavy ones:
 * `WatchPage` brings the player, `TitlePage` and `CataloguePage` bring the poster grids.
 *
 * Suspense lives in `AppShell`, which wraps the outlet, so a route swap that is already cached
 * shows nothing and one that has to download gets `LoadingState` instead of a blank frame.
 */
const ExplorePage = lazy(() => import('./pages/ExplorePage').then((m) => ({ default: m.ExplorePage })));
const CataloguePage = lazy(() => import('./pages/CataloguePage').then((m) => ({ default: m.CataloguePage })));
const TitlePage = lazy(() => import('./pages/TitlePage').then((m) => ({ default: m.TitlePage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then((m) => ({ default: m.SearchPage })));
const RecommendedPage = lazy(() => import('./pages/RecommendedPage').then((m) => ({ default: m.RecommendedPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const WatchPage = lazy(() => import('./pages/WatchPage').then((m) => ({ default: m.WatchPage })));
const AccountPage = lazy(() => import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })));

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
            <AuthProvider>
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

                  {/* The account portal: profile, stats and watch history. */}
                  <Route path="account" element={<AccountPage />} />

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
            </AuthProvider>
          </BrowserRouter>
        </ErrorBoundary>
      </ThemeModeProvider>
    </ToastProvider>
  );
}