import { Suspense, useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
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
  Sun,
  Target,
  Television,
  UserCircle,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { ROUTES } from '../../lib/routes';
import { LoadingState } from '../ui';
import { useAnchoredPanel } from '../../hooks/useAnchoredPanel';
import { useExitFade } from '../../hooks/useExitFade';
import { useSpringIndicator } from '../../hooks/useSpringIndicator';
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
];

/**
 * How far a horizontal drag across the bottom capsule must travel before it counts as a swipe.
 *
 * Below this the gesture is a tap that wobbled, and navigating on it would fire on every
 * thumb that lands slightly off centre. The vertical allowance is a ratio rather than a
 * second distance: a drag across a bar only 50px tall cannot be both long and horizontal
 * unless the horizontal half clearly dominates.
 */
const TAB_SWIPE_MIN_DX = 40;
const TAB_SWIPE_VERTICAL_SLACK = 1.4;

/** How long a swipe keeps swallowing the click the browser fires after `touchend`. */
const TAB_SWIPE_CLICK_GUARD = 500;

/*
 * The one-time brand intro, spelled out on first paint.
 *
 * The wordmark types itself letter by letter over the app surface, then the whole typed word
 * glides down to where the logo actually rests - the header's brand on the compact layout, the
 * rail's wordmark from laptop widths up - and the surface lifts to reveal it. The text mirrors
 * `public/reflick-logo.svg` exactly - same Bodoni Moda stack, same weight, same wide tracking,
 * same caps, same red - so the glide lands on the logo's own pixels; the letter-spacing is the
 * logo's `5` units at its `44`px face, i.e. about `0.11em`. Timing constants get their own names
 * because the choreography touches three separate phases.
 */
const BRAND_NAME = 'REFLICK';
const BRAND_LETTER_MS = 130;
const BRAND_LAND_DELAY_MS = 300;
const BRAND_GLIDE_MS = 720;
const BRAND_FADE_MS = 640;

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
  // Keep the menu in the tree long enough to fade back out, matching its fade-in.
  const menu = useExitFade(menuOpen);

  /*
    The one-time brand intro.

    Runs exactly once per full page load - AppShell mounts with the app and persists for the
    whole session, so nothing here can replay on a route change. `matchMedia` is read in the
    initialiser so `reduce` visitors never even see the overlay flash; the phase machine then
    walks typing -> glide -> fading -> done on a set of timers.
  */
  const [brandPhase, setBrandPhase] = useState<'typing' | 'glide' | 'fading' | 'done'>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'done'
      : 'typing',
  );
  const [brandLetters, setBrandLetters] = useState(0);
  const [brandTransform, setBrandTransform] = useState<CSSProperties>({});
  const brandWordRef = useRef<HTMLSpanElement>(null);
  const railBrandRef = useRef<HTMLAnchorElement>(null);
  const topBrandRef = useRef<HTMLAnchorElement>(null);

  /* Typewriter: one letter per beat, then the interval stops itself on the last one. */
  useEffect(() => {
    if (brandPhase !== 'typing') return;
    const interval = window.setInterval(() => {
      setBrandLetters((count) => {
        if (count >= BRAND_NAME.length) {
          window.clearInterval(interval);
          return count;
        }
        return count + 1;
      });
    }, BRAND_LETTER_MS);
    return () => window.clearInterval(interval);
  }, [brandPhase]);

  /*
    The glide, once the word is complete.

    The endpoint is measured, not assumed: whichever brand link is actually visible - the rail's
    wordmark at laptop widths and up, the header's logo below that - is where the typed word is
    going. The hidden link reports a zero-sized rect, which is what lets the filter pick the
    real one. A short pause after the last letter is what gives the completed word a moment to
    be read before it travels.
  */
  useEffect(() => {
    if (brandPhase !== 'typing' || brandLetters < BRAND_NAME.length) return;

    const settle = window.setTimeout(() => {
      const word = brandWordRef.current;
      if (!word) {
        setBrandPhase('done');
        return;
      }
      const start = word.getBoundingClientRect();
      if (start.width === 0) {
        setBrandPhase('done');
        return;
      }

      const target = [railBrandRef.current, topBrandRef.current]
        .filter((element): element is HTMLAnchorElement => element !== null)
        .map((element) => element.getBoundingClientRect())
        .find((rect) => rect.width > 0 && rect.height > 0);
      if (!target) {
        setBrandPhase('done');
        return;
      }

      const dx = target.left + target.width / 2 - (start.left + start.width / 2);
      const dy = target.top + target.height / 2 - (start.top + start.height / 2);
      setBrandTransform({ transform: `translate(${dx}px, ${dy}px) scale(${target.width / start.width})` });
      setBrandPhase('glide');
    }, BRAND_LAND_DELAY_MS);

    return () => window.clearTimeout(settle);
  }, [brandPhase, brandLetters]);

  /* Fade the surface after the glide lands, then drop the overlay from the tree entirely. */
  useEffect(() => {
    if (brandPhase !== 'glide') return;
    const fade = window.setTimeout(() => setBrandPhase('fading'), BRAND_GLIDE_MS);
    const done = window.setTimeout(() => setBrandPhase('done'), BRAND_GLIDE_MS + BRAND_FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [brandPhase]);

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

  const navigate = useNavigate();

  /*
    Spring fills: one for the header's destination pills, one for the bottom capsule. Both
    are a single absolutely-positioned span whose geometry the hook measures, so the red
    fill travels between tabs with an overshoot instead of blinking off one link and on to
    the next.
  */
  const topIndicator = useSpringIndicator();
  const tabIndicator = useSpringIndicator();

  /*
    Swipe across the bottom capsule to move between destinations.

    Only the horizontal half of the gesture is read. A vertical drag is someone trying to
    scroll the page under the bar, and a tap that barely moves is a tap - so the gesture
    counts only when it clears both distances, and the destination only changes when the
    swipe actually lands somewhere new.
  */
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipedAtRef = useRef(0);

  const handleTabTouchStart = (event: ReactTouchEvent<HTMLElement>): void => {
    const touch = event.touches[0];
    if (!touch) return;
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTabTouchEnd = (event: ReactTouchEvent<HTMLElement>): void => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;

    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < TAB_SWIPE_MIN_DX || Math.abs(dx) < Math.abs(dy) * TAB_SWIPE_VERTICAL_SLACK) return;

    /*
      The current tab is read from `aria-current` rather than tracked as state: it is what
      React Router already writes on the matching link, it cannot drift from the route, and
      it keeps the gesture working without another source of truth for "where am I".
    */
    const container = tabIndicator.containerRef.current;
    const tabs = container ? Array.from(container.querySelectorAll('a')) : [];
    const current = tabs.findIndex((tab) => tab.getAttribute('aria-current') === 'page');
    if (current === -1) return;

    const target = Math.min(Math.max(current + (dx < 0 ? 1 : -1), 0), TOP_NAV.length - 1);
    const destination = TOP_NAV[target];
    if (target === current || !destination) return;

    swipedAtRef.current = Date.now();
    navigate(destination.to);
  };

  /*
    After a swipe the browser still fires a click on whatever tab the finger lifted from,
    which would navigate back to the tab just left. Swallowing that click for the next half
    second is what makes the swipe and the tap mutually exclusive; outside that window the
    guard is inert and ordinary taps pass through.
  */
  const handleTabClickCapture = (event: ReactMouseEvent<HTMLElement>): void => {
    if (Date.now() - swipedAtRef.current > TAB_SWIPE_CLICK_GUARD) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className={styles.shellRoot ?? ''} data-theme={theme}>
      <div className={styles.shellContainer ?? ''}>
        <div className={styles.shellGrid ?? ''}>
          {/* ------------------------------------------------------- Rail */}
          <aside className={styles.sidebarColumn ?? ''}>
            <div className={styles.sidebarRail ?? ''}>
              <div className={styles.sidebarInner ?? ''}>
                <div className={styles.brandHeader ?? ''}>
                  <Link
                    to={ROUTES.home}
                    ref={railBrandRef}
                    className={styles.brandWordmark ?? ''}
                    aria-label="Reflick home"
                  >
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
              <Link
                to={ROUTES.home}
                ref={topBrandRef}
                className={topNavStyles.brand ?? ''}
                aria-label="Reflick home"
              >
                <img src="/reflick-logo.svg" alt="" />
              </Link>

              <nav
                ref={topIndicator.containerRef}
                className={topNavStyles.categoryGroup ?? ''}
                aria-label="Sections"
              >
                <span
                  ref={topIndicator.indicatorRef}
                  className={topNavStyles.categoryIndicator ?? ''}
                  style={topIndicator.indicatorStyle}
                  aria-hidden
                />
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
              {/*
                Route-level suspense.

                Pages are lazy (see `App.tsx`), so the boundary sits over the outlet rather than
                inside any one route: a cached navigation renders straight through with no flash,
                and a first visit to a section downloads its chunk behind `LoadingState`.

                The wrapper is keyed on the pathname, which does two jobs. It remounts the page
                on navigation so the entrance replays on every route change, and it keeps the
                query string out of it - picking an episode or a sort does not restart the page.
                The entrance itself is picked here too: playback gets `watchOpen`, which shares
                the page's fade so clicking Watch reads as the next screen arriving rather than
                sliding in.
              */}
              <Suspense fallback={<LoadingState />}>
                <div
                  key={location.pathname}
                  className={`${styles.pageStack ?? ''} ${
                    location.pathname.startsWith('/watch') ? (styles.watchEnter ?? '') : (styles.pageEnter ?? '')
                  }`.trim()}
                >
                  <Outlet />
                </div>
              </Suspense>
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
      {menu.show ? (
        <div
          className={[styles.overflowMenu ?? '', menu.leaving ? (styles.overflowMenuExit ?? '') : '']
            .filter(Boolean)
            .join(' ')}
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
        destination as a nested pill. The red fill behind the active pill is one element
        that springs between tabs, and a horizontal swipe across the capsule walks the
        selection one destination at a time - so the bar is driven by a tap, a swipe, or
        whatever route the reader arrived on, and reads the same way in all three.

        The rail and a crowded header pill row were the two mobile problems - the rail
        collapsed to a three-column card wedged above the content, and four pills plus
        three action icons could not share one line. The capsule keeps the four
        destinations together, and the header keeps search, theme and a dots menu for the
        rest.

        Mirrors `TOP_NAV` so the primary destinations read the same on every screen.
      */}
      <nav
        ref={tabIndicator.containerRef}
        className={styles.mobileTabBar ?? ''}
        aria-label="Primary navigation"
        onTouchStart={handleTabTouchStart}
        onTouchEnd={handleTabTouchEnd}
        onClickCapture={handleTabClickCapture}
      >
        <span
          ref={tabIndicator.indicatorRef}
          className={styles.mobileTabIndicator ?? ''}
          style={tabIndicator.indicatorStyle}
          aria-hidden
        />
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
                <item.icon size={18} weight={isActive ? 'fill' : 'bold'} aria-hidden />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* One overlay, regardless of which button opened it. */}
      <SearchOverlay open={searchOpen} onOpenChange={setSearchOpen} />

      {/*
        The brand intro, while it is still running.

        Fixed full-viewport surface with only the word and its caret on it. It is decorative -
        `aria-hidden` and `pointer-events: none` - so the app behind is fully usable the moment
        it stops covering the screen, and the whole box is removed from the tree once the fade
        completes. `will-change` lives in the CSS; here only the measured glide transform changes.
        On the run the typed text hands over to the actual `reflick-logo.svg`, scaled to the same
        landing box, so the last thing on screen before the surface lifts is the logo's own
        pixels, not a lookalike.
      */}
      {brandPhase !== 'done' ? (
        <div
          className={`${styles.brandIntro ?? ''} ${brandPhase === 'fading' ? (styles.brandIntroFade ?? '') : ''}`.trim()}
          aria-hidden
        >
          <span ref={brandWordRef} className={styles.brandIntroWord ?? ''} style={brandTransform}>
            {Array.from(BRAND_NAME.slice(0, brandLetters)).map((character, index) => (
              <span key={index} className={brandPhase === 'fading' ? (styles.brandIntroLetterSettled ?? '') : ''}>
                {character}
              </span>
            ))}
            {brandLetters < BRAND_NAME.length ? (
              <span className={styles.brandIntroCaret ?? ''} aria-hidden />
            ) : null}
            {brandPhase === 'fading' ? (
              <img src="/reflick-logo.svg" alt="" className={styles.brandIntroLogo ?? ''} />
            ) : null}
          </span>
        </div>
      ) : null}
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
