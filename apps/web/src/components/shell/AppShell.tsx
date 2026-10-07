import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Bell,
  Compass,
  DotsThree,
  FilmSlate,
  Flame,
  Gear,
  House,
  MagnifyingGlass,
  Moon,
  Smiley,
  Sun,
  Target,
  Television,
  UserCircle,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { ROUTES } from '../../lib/routes';
import { useAnchoredPanel } from '../../hooks/useAnchoredPanel';
import { useThemeMode } from './ThemeMode';
import { SearchOverlay, SearchOverlayButton, useSearchOverlay } from './SearchOverlayTrigger';
import { ContinueWatching } from './ContinueWatching';
import styles from './AppShell.module.css';
import topNavStyles from './TopNav.module.css';


/**
 * Header destinations.
 *
 * Real links rather than the old in-place filter buttons. Every entry is its own route,
 * because the previous pills looked identical to links but only narrowed shelves below -
 * so "Movies" and a genuine movies page could never both exist. `end` on the home link is
 * what stops React Router matching it for every nested path.
 *
 * This row and the rail are deliberately not the same list: the header carries the
 * catalogue sections, the rail carries where you are. Duplicating all seven across both
 * gave "where am I" two answers.
 */
const TOP_NAV: Array<{ id: string; label: string; to: string; icon: Icon }> = [
  { id: 'home', label: 'Home', to: ROUTES.home, icon: House },
  { id: 'explore', label: 'Explore', to: ROUTES.explore, icon: Compass },
  { id: 'movies', label: 'Movies', to: ROUTES.films, icon: FilmSlate },
  { id: 'series', label: 'Series', to: ROUTES.series, icon: Television },
  { id: 'kids', label: 'Kids', to: ROUTES.kids, icon: Smiley },
];

/**
 * The permanent frame: rail on the left, header plus one scrollport on the right.
 *
 * Every page renders inside `<Outlet />` and supplies only content. The previous arrangement
 * had each page draw its own rail and header, so navigating rebuilt the navigation, the
 * search field lost its value on every route change, and the two copies inevitably drifted.
 *
 * Search lives here rather than per page for the same reason: one control, one query, one
 * shortcut, and it keeps its identity while you move between sections. The control itself is
 * only a trigger - the query is typed in a centred overlay, which is the whole reason it is
 * not an inline field.
 */
export function AppShell() {
  const { resolved: theme, mode, cycle } = useThemeMode();
  const location = useLocation();
  const { open: searchOpen, setOpen: setSearchOpen } = useSearchOverlay();
  const [menuOpen, setMenuOpen] = useState(false);
  const { rootRef: menuAnchorRef, panelRef: menuPanelRef, panelStyle: menuStyle } =
    useAnchoredPanel<HTMLButtonElement>(menuOpen, 'fixed');

  /*
    Every navigation resets the scrollport.

    The document itself never scrolls (the shell is height-locked), so `ScrollToTop` in
    `App.tsx` cannot reach the content: it calls `window.scrollTo`, which has nothing to do
    here. Without this, returning to a long page from a short one lands you halfway down the
    previous scroll position, because React Router reuses the same DOM node.

    Keyed on `pathname` alone, never the query string, so changing a sort or picking an
    episode does not throw away the reader's place.
  */
  const scrollRef = useRef<HTMLElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  /*
    The dots menu has no room to stay open across navigation or to dismiss itself on a tap
    elsewhere. Closing it on route change covers the back button as well, and the pointer /
    Escape handlers cover the in-page case.
  */
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as HTMLElement;

      // Tapping the dots button to close the menu would otherwise see the pointerdown first,
      // close the panel, and then the click immediately reopen it.
      if (target.closest('[data-menu-toggle]')) return;
      if (target.closest(`.${styles.overflowMenu}`)) return;
      setMenuOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className={styles.shellRoot ?? ''} data-theme={theme}>
      <div className={styles.shellContainer ?? ''}>
        <div className={styles.shellGrid ?? ''}>
          {/* ------------------------------------------------------- Rail */}
          <aside className={styles.sidebarColumn ?? ''}>
            <div className={styles.sidebarRail ?? ''}>
              <div className={styles.sidebarInner ?? ''}>
                <div className={styles.brandHeader ?? ''}>
                  <Link to={ROUTES.home} className={styles.brandWordmark ?? ''} aria-label="Reflick home">
                    <img src="/reflick-logo.svg" alt="" />
                  </Link>
                </div>

                {/* The one search in the app: a trigger that opens a centred overlay. */}
                <SearchOverlayButton onClick={() => setSearchOpen(true)} />

                {/* ------------------------------------------------- Nav */}
                <nav className={styles.navList ?? ''} aria-label="Primary">
                  <NavItem to={ROUTES.home} icon={House} label="Home" />
                  <NavItem to={ROUTES.explore} icon={Compass} label="Explore" />
                  <NavItem to={ROUTES.popular} icon={Flame} label="Popular" />

                  <div className={styles.sidebarDivider ?? ''} />

                  {/*
                    `Target`, not `MagicWand` and not `Sparkle`.

                    The wand was here to keep the personalisation read while staying unique to the
                    rail - `Sparkle` was already on the Recommendations page's two empty states, and
                    the same glyph in two places with two meanings made neither identifiable. But a
                    wand is a tool, and this item is not a tool: it is the one place in the rail that
                    is about the reader rather than about the catalogue.

                    A target says "aimed at you" and is the only glyph in the rail that points
                    somewhere rather than naming a place - `House` and `Compass` both navigate to a
                    destination, `Flame` ranks one, `Gear` configures, and this one filters the
                    catalogue by taste.
                  */}
                  <NavItem to={ROUTES.recommended} icon={Target} label="For you" />
                  <NavItem to={ROUTES.settings} icon={Gear} label="Settings" />
                </nav>

                {/* ------------------------------------- Continue watching */}
                <ContinueWatching />
              </div>
            </div>
          </aside>

          {/* ------------------------------ Right column: header + content */}
          <div className={styles.shellMain ?? ''}>
            {/*
              Logo, destinations, account. In that order, on one line.

              The three-column grid is what makes "everything in the middle" literally true: the
              centre track is sized to the destinations and the two side tracks split the leftover
              space evenly, so the destination group sits on the header's midpoint rather than
              wherever the leftovers happen to fall. `margin-inline: auto` on the group could not
              do this - it centres against the leftover space, which is off-centre by however much
              the logo is wider than the profile button.

              The logo moved here from the top of the rail so it is the leftmost thing in the
              app on every screen. Having it in both places meant "Reflick" appeared twice on desktop,
              and the rail copy was above a search box with no header of its own.
            */}
            <header className={topNavStyles.topNav ?? ''}>
              <Link to={ROUTES.home} className={topNavStyles.brand ?? ''} aria-label="Reflick home">
                <img src="/reflick-logo.svg" alt="" />
              </Link>

              <nav className={topNavStyles.categoryGroup ?? ''} aria-label="Sections">
                {TOP_NAV.map((item) => (
                  <NavLink
                    key={item.id}
                    to={item.to}
                    end={item.to === ROUTES.home}
                    className={({ isActive }) =>
                      [
                        topNavStyles.categoryPill ?? '',
                        isActive ? (topNavStyles.categoryPillActive ?? '') : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon size={16} weight={isActive ? 'fill' : 'bold'} aria-hidden />
                        <span>{item.label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </nav>

              <div className={topNavStyles.actions ?? ''}>
                <button
                  type="button"
                  className={`${topNavStyles.circleButton ?? ''} ${topNavStyles.mobileAction ?? ''}`.trim()}
                  onClick={() => setSearchOpen(true)}
                  aria-label="Search"
                >
                  <MagnifyingGlass size={18} aria-hidden />
                </button>

                {/*
                  Icon-only, and inert.

                  There is no auth in this app, so an avatar with a name would be invented
                  data. A plain control marks where the feature will live without pretending
                  someone is signed in. The bell is the same: no notifications exist to show.
                  Both are hidden on mobile, where the row moves to the bottom tab bar instead
                  of competing with a search field and a menu control.
                */}
                <button
                  type="button"
                  className={`${topNavStyles.circleButton ?? ''} ${topNavStyles.hideOnMobile ?? ''}`.trim()}
                  aria-label="Notifications"
                >
                  <Bell size={18} />
                </button>

                {/* Secondary destinations and the theme switch; the tab bar cannot carry them. */}
                <button
                  type="button"
                  data-menu-toggle
                  ref={menuAnchorRef}
                  className={topNavStyles.circleButton ?? ''}
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-label="More options"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                >
                  <DotsThree size={18} weight="bold" aria-hidden />
                </button>

                {/* Rightmost, so "your account" reads as the end of the row. */}
                <button
                  type="button"
                  className={`${topNavStyles.profileButton ?? ''} ${topNavStyles.hideOnMobile ?? ''}`.trim()}
                  aria-label="Profile"
                >
                  <UserCircle size={30} weight="fill" aria-hidden />
                </button>
              </div>
            </header>

            {/*
              The only scrollport in the app.

              A sibling of the header inside the right column, so content scrolls beneath the
              header rather than under it. `min-height: 0` on the column above is what lets
              this become a scrollport instead of pushing the page taller than the viewport.
            */}
            <main id="main" ref={scrollRef} className={styles.shellScroll ?? ''} tabIndex={-1}>
              <div className={styles.pageStack ?? ''}>
                <Outlet />
              </div>
            </main>
          </div>
        </div>
      </div>

      {/*
        Overflow menu: the destinations the tab bar cannot carry, plus the theme switch.

        The theme switch lived in the header as a third icon. Moving it in here is what let the
        header keep exactly two things on the right - the menu and the profile - so the row reads
        as "logo, where you are, you" instead of "logo, where you are, search, brightness,
        notifications, more, you". It is the least-used control in the app, so it is the right
        one to spend a layer of indirection on.
      */}
      {menuOpen ? (
        <div
          className={styles.overflowMenu ?? ''}
          ref={menuPanelRef}
          style={menuStyle}
          role="menu"
          aria-label="More options"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('a')) setMenuOpen(false);
          }}
        >
          {/*
            A button, not a link, so it closes the menu when used. An anchor would leave the panel
            open behind the theme swap, which is the one moment the header's own state changes
            under it.
          */}
          <button
            type="button"
            className={styles.overflowMenuItem ?? ''}
            role="menuitem"
            onClick={() => cycle()}
            aria-label={`Toggle theme: ${theme}, currently ${mode}`}
          >
            {theme === 'dark' ? <Moon size={16} weight="fill" aria-hidden /> : <Sun size={16} weight="bold" aria-hidden />}
            <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
            <span className={styles.overflowMenuHint ?? ''}>
              {mode === 'auto' ? 'Auto device' : 'Manual'}
            </span>
          </button>

          <NavLink to={ROUTES.popular} className={styles.overflowMenuItem ?? ''} role="menuitem">
            <Flame size={16} aria-hidden />
            <span>Popular</span>
          </NavLink>
          <NavLink to={ROUTES.recommended} className={styles.overflowMenuItem ?? ''} role="menuitem">
            <Target size={16} aria-hidden />
            <span>For you</span>
          </NavLink>
          <NavLink to={ROUTES.settings} className={styles.overflowMenuItem ?? ''} role="menuitem">
            <Gear size={16} aria-hidden />
            <span>Settings</span>
          </NavLink>
        </div>
      ) : null}

      {/*
        Mobile primary navigation.

        A floating bottom capsule, matching the header's destination group rather than a
        full-bleed tab strip: an inset rounded pill hovering over the content, with each
        destination as a nested pill that fills red when active. The rail and a crowded
        header pill row were the two mobile problems - the rail collapsed to a three-column
        card wedged above the content, and five pills plus three action icons could not
        share one line. The capsule keeps the five destinations together, and the header
        keeps search, theme and a dots menu for the rest.

        Mirrors `TOP_NAV` so the primary destinations read the same on every screen.
      */}
      <nav className={styles.mobileTabBar ?? ''} aria-label="Primary navigation">
        {TOP_NAV.map((item) => (
          <NavLink
            key={item.id}
            to={item.to}
            end={item.to === ROUTES.home}
            className={({ isActive }) =>
              `${styles.mobileTab ?? ''} ${isActive ? (styles.mobileTabActive ?? '') : ''}`.trim()
            }
          >
            {({ isActive }) => (
              <>
                <item.icon size={20} weight={isActive ? 'fill' : 'bold'} aria-hidden />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* One overlay, regardless of which button opened it. */}
      <SearchOverlay open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

/**
 * One rail link.
 *
 * `NavLink` rather than `Link` so the active state comes from the router. The active row gets
 * three cues - red text, heavier weight, and a trailing dot - because colour alone fails
 * SC 1.4.1 for anyone who cannot separate the accent from the muted grey. The dot is
 * rendered only on the active item; the CSS reserves its width on every row so the labels
 * stay aligned either way.
 *
 * Small on purpose: 18px glyphs in a 0.875rem face. At 20px and 0.9375rem the rail's five rows
 * plus the trigger plus Continue watching reached the viewport height on a 13" laptop, and the
 * last row started to look cut off rather than deliberately compact.
 */
function NavItem({ to, icon: Glyph, label }: { to: string; icon: Icon; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === ROUTES.home}
      className={({ isActive }) => [styles.navItem ?? '', isActive ? (styles.navItemActive ?? '') : ''].filter(Boolean).join(' ')}
    >
      {({ isActive }) => (
        <>
          <Glyph size={18} weight={isActive ? 'fill' : 'bold'} aria-hidden />
          <span>{label}</span>
          {isActive ? <span className={styles.navDot ?? ''} aria-hidden /> : null}
        </>
      )}
    </NavLink>
  );
}
