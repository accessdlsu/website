"use client";

import {
  useLayoutEffect,
  useEffect,
  useState,
  useMemo,
  useRef,
  useSyncExternalStore,
  Suspense,
} from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Info,
  CalendarDays,
  GraduationCap,
  Users,
  Menu,
  BookOpen,
  UserCircle,
  Trophy,
  Bot,
  FileText,
  Plus,
  History,
  Wrench,
  Award,
  Library,
  Video,
  FolderOpen,
  HeartHandshake,
  UserCheck,
  Network,
  LogOut,
  AlertCircle,
  Lock,
  X,
  Maximize2,
} from "lucide-react";
import { useSession, signIn, signOut } from "next-auth/react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";

// Separate component for search params handling
import {
  NavbarLink,
  NavbarDropdownTrigger,
  DropdownMenu,
  type NavItem
} from "@/components/ui/navbar";

// Live corner-pill FLIP animations, so an interrupting breakpoint
// crossing can cancel the previous glide and continue from its exact
// position.
const cornerFlipAnims = new WeakMap<HTMLElement, Animation>();

// The folded (side-by-side) posture, as a store so components can read it
// without a setState-in-effect.
const FOLD_MEDIA =
  "(horizontal-viewport-segments: 2) and (vertical-viewport-segments: 1)";

function subscribeFold(callback: () => void) {
  const mq = window.matchMedia(FOLD_MEDIA);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

// The rail's form factor — picked by the shape you drag it into: dominant
// width -> the 4x1 bar, dominant height -> the 1x4 column, otherwise the
// 2x2 square.
type RailForm = "row" | "grid" | "col";

function formFromSize(w: number, h: number): RailForm {
  const ratio = w / h;
  if (ratio > 1.3) return "row";
  if (ratio < 0.77) return "col";
  return "grid";
}

// Navigation Configuration
const NAV_CONFIG: NavItem[] = [
  {
    id: "about",
    label: "About Us",
    icon: Info,
    isDropdown: true,
    dropdownContent: [
      {
        title: "Who We Are",
        items: [
          { label: "About ACCESS", href: "/about-us", icon: Info },
        ],
      },
      {
        title: "Accomplishments",
        items: [
          { label: "21st Archives", href: "/about-us/21st-archives", icon: Trophy },
        ],
      },
    ],
  },
  {
    id: "events",
    label: "Events",
    icon: CalendarDays,
    isDropdown: true,
    dropdownContent: [
      {
        title: "Browse Events",
        items: [
          { label: "Upcoming Events", href: "/events/upcoming", icon: CalendarDays },
          { label: "Past Events", href: "/events/past", icon: History },
        ],
      },
      {
        title: "By Type",
        items: [
          { label: "Workshops", href: "/events/workshops", icon: Wrench },
          { label: "Competitions", href: "/events/competitions", icon: Award },
        ],
      },
    ],
  },
  {
    id: "academics",
    label: "Academics",
    icon: GraduationCap,
    isDropdown: true,
    dropdownContent: [
      {
        title: "Learn",
        items: [
          { label: "Resources", href: "/academics/resources", icon: Library },
          { label: "Tutorials", href: "/academics/tutorials", icon: Video },
        ],
      },
      {
        title: "Get Involved",
        items: [
          { label: "Project Gallery", href: "/academics/projects", icon: FolderOpen },
          { label: "Mentorship", href: "/academics/mentorship", icon: HeartHandshake },
        ],
      },
    ],
  },
  {
    id: "members",
    label: "Members",
    icon: Users,
    isDropdown: true,
    dropdownContent: [
      {
        title: "Directory",
        items: [
          { label: "Members", href: "/members/directory", icon: UserCheck },
          { label: "Officers", href: "/members/officers", icon: Users },
        ],
      },
      {
        title: "Community",
        items: [
          { label: "Alumni Network", href: "/members/alumni", icon: Network },
        ],
      },
    ],
  },
];


function AuthErrorHandler({
  onAuthError,
}: {
  onAuthError: (error: string | null) => void;
}) {
  const searchParams = useSearchParams();

  useEffect(() => {
    const error = searchParams?.get("error");
    if (error === "AccessDenied") {
      onAuthError(
        "Only DLSU email addresses (@dlsu.edu.ph) are allowed to sign in.",
      );

      // Clear the error from URL
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("error");
        window.history.replaceState({}, "", url.toString());
      }

      // Clear error message after 5 seconds
      const timer = setTimeout(() => onAuthError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [searchParams, onAuthError]);

  return null;
}

const HeaderContent = ({
  authError,
  setAuthError,
}: {
  authError: string | null;
  setAuthError: (error: string | null) => void;
}) => {
  const { data: session, status } = useSession();
  // Folded (segmented) posture. One component morphs between the square
  // nav pad and the focused item's submenu panel, so the nav needs to know
  // the posture in render.
  const isFolded = useSyncExternalStore(
    subscribeFold,
    () => window.matchMedia(FOLD_MEDIA).matches,
    () => false
  );
  // While the session resolves (true during SSR too, so hydration
  // matches), the profile pill shows the generic avatar circle — the
  // same 60px shape as the logged-in pill, so signed-in users get a
  // plain icon->image swap with no pill morph; only signed-out users
  // see one small intentional circle->Login transition.
  const authLoading = status === "loading";
  const [isVisible, setIsVisible] = useState(true);
  const [isCompressed, setIsCompressed] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isLoginExpanded, setIsLoginExpanded] = useState(false); // Track login pill expansion
  const [isOfficer, setIsOfficer] = useState(false);
  const [officerChecked, setOfficerChecked] = useState(false);

  // When true, suppress all nav transitions so the compressed pill appears
  // fully-formed when revealed from a hidden state (no expanding animation).
  // Persists until the navbar expands (trigger click or scroll to top).
  const [revealInstant, setRevealInstant] = useState(false);

  // Corner-pill FLIP morph across the 1200px layout swap. The
  // from-position is COMPUTED, not sampled (sampling races the style
  // recalc); WAAPI animates from it and tracks the live layout, so a
  // fast-drag interrupting crossing just reverses mid-glide. View
  // Transitions were tried here, but the browser skips them on window
  // resize — the exact moment this runs.
  const logoRef = useRef<HTMLDivElement | null>(null);
  const loginRef = useRef<HTMLDivElement | null>(null);
  const wasMobileRef = useRef<boolean | null>(null);

  // Desktop wrapper: centered flex row at top 1rem, gap 0.75rem.
  // clientWidth (not innerWidth) — fixed elements center within the
  // initial containing block, which excludes the scrollbar.
  const desktopCornerPositions = () => {
    const vw = document.documentElement.clientWidth;
    const gap = 12;
    const top = 16;
    const logoW = logoRef.current?.offsetWidth ?? 0;
    const loginW = loginRef.current?.offsetWidth ?? 0;
    const pillW =
      document.querySelector(".navbar")?.getBoundingClientRect().width ?? 0;
    const left0 = (vw - (logoW + gap + pillW + gap + loginW)) / 2;
    return {
      logo: { left: left0, top },
      login: { left: left0 + logoW + gap + pillW + gap, top },
    };
  };

  // Mobile corners: fixed at top 1rem / left 1rem, login pinned right.
  const mobileCornerPositions = () => {
    const vw = document.documentElement.clientWidth;
    const loginW = loginRef.current?.offsetWidth ?? 98;
    return {
      logo: { left: 16, top: 16 },
      login: { left: vw - 16 - loginW, top: 16 },
    };
  };

  const playCornerFlip = (from: {
    logo: { left: number; top: number };
    login: { left: number; top: number };
  }) => {
    const play = (el: HTMLElement | null, fromPos: { left: number; top: number }) => {
      if (!el) return;
      // Read the rect BEFORE cancelling so a mid-glide interruption
      // continues from its exact visual position.
      const last = el.getBoundingClientRect();
      const dx = fromPos.left - last.left;
      const dy = fromPos.top - last.top;
      if (!dx && !dy) return;
      const interrupted = cornerFlipAnims.get(el);
      interrupted?.cancel();
      const anim = el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0, 0)" },
        ],
        {
          duration: 350,
          // Clean crossing: let the navbar pill's exit lead by 0.12s.
          // Interrupted glide: continue immediately, no hold.
          // fill "backwards" holds the from-position during the delay —
          // without it the element flashes at its final CSS spot first.
          delay: interrupted ? 0 : 120,
          fill: "backwards",
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        }
      );
      cornerFlipAnims.set(el, anim);
    };
    play(logoRef.current, from.logo);
    play(loginRef.current, from.login);
  };

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1200px)");
    wasMobileRef.current = mq.matches;

    const onBreakpoint = () => {
      if (mq.matches === wasMobileRef.current) return;
      wasMobileRef.current = mq.matches;
      // The wrapper's scroll-reveal transition must not ride the swap.
      document.documentElement.classList.add("nav-morphing");
      window.setTimeout(() => {
        document.documentElement.classList.remove("nav-morphing");
      }, 600);
      playCornerFlip(
        mq.matches ? desktopCornerPositions() : mobileCornerPositions()
      );
    };

    mq.addEventListener("change", onBreakpoint);
    return () => {
      mq.removeEventListener("change", onBreakpoint);
    };
  }, []);

  // Memoize boolean to keep dependency array stable
  const hasActiveDropdown = useMemo(
    () => activeDropdown !== null,
    [activeDropdown],
  );

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      // Close dropdown and exit focus mode when scrolling
      setActiveDropdown(null);
      setIsFocusMode(false);
      setIsLoginExpanded(false); // Close login pill on scroll

      // Show full header when at top (within 10px)
      if (currentScrollY < 10) {
        setIsVisible(true);
        setIsCompressed(false);
        // Expanding to full size at the top animates normally (the
        // revealInstant suppression is only for mid-page reveals).
        setRevealInstant(false);
      }
      // Hide header when scrolling down
      else if (currentScrollY > lastScrollY && currentScrollY > 100) {
        // Preserve the compressed state when hiding. If the navbar is currently
        // compressed and we force setIsCompressed(false) here, it briefly expands
        // to the default/full state before hiding — causing the unwanted animation.
        // To avoid that, only change visibility; keep `isCompressed` as-is so the
        // navbar hides directly from the compressed appearance.
        setIsVisible(false);
      }
      // Show compressed navbar when scrolling up (not at top)
      else if (currentScrollY < lastScrollY && currentScrollY > 100) {
        // Only compress when revealing from a hidden state; an already
        // visible navbar keeps its current size (expanded stays expanded)
        // so it doesn't compress-then-re-expand on the way to the top.
        if (!isVisible) {
          setRevealInstant(true);
          setIsCompressed(true);
        }
        setIsVisible(true);
        // Don't reset isExpanded - keep it if already expanded
      }
      // Show full header when scrolling up near top
      else if (currentScrollY < lastScrollY && currentScrollY <= 100) {
        setIsVisible(true);
        setIsCompressed(false);
        setRevealInstant(false);
      }

      setLastScrollY(currentScrollY);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [lastScrollY, isVisible]);

  // Specular sheen position for the tinted glass button variants
  // (.btn-green/.btn-red/.btn-blue): the highlight follows the cursor.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest(
        ".btn-green, .btn-red, .btn-blue"
      ) as HTMLElement | null;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      btn.style.setProperty("--mx", `${e.clientX - r.left}px`);
      btn.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    document.addEventListener("mousemove", onMove, { passive: true });
    return () => document.removeEventListener("mousemove", onMove);
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // Check if click is inside login container or the portaled popup
      const target = e.target as HTMLElement;
      if (target.closest(".login-container") || target.closest(".login-expanded"))
        return;

      setActiveDropdown(null);
      setIsFocusMode(false); // Reset focus mode when clicking outside
      setIsLoginExpanded(false); // Close login pill when clicking outside
    };

    if (hasActiveDropdown || isLoginExpanded) {
      document.addEventListener("click", handleClickOutside);
    }

    return () => {
      if (hasActiveDropdown || isLoginExpanded) {
        document.removeEventListener("click", handleClickOutside);
      }
    };
  }, [hasActiveDropdown, isLoginExpanded, isFolded, activeDropdown]);

  // Check officer status when session changes
  useEffect(() => {
    const checkOfficerStatus = async () => {
      if (session?.user?.email) {
        try {
          const response = await fetch("/api/officers/check");
          const data = (await response.json()) as { isOfficer?: boolean };
          setIsOfficer(data.isOfficer ?? false);
        } catch (error) {
          console.error("Error checking officer status:", error);
          setIsOfficer(false);
        }
      } else {
        setIsOfficer(false);
      }
      setOfficerChecked(true);
    };

    checkOfficerStatus();
  }, [session]);

  const handleCompressedClick = () => {
    // Toggle compressed state when user clicks the menu trigger
    if (isCompressed) setRevealInstant(false);
    setIsCompressed(!isCompressed);
  };

  // Folded-posture one-hand rail side + form factor. DOM-only (attributes
  // + storage) so they stay SSR-safe and need no render-time state.
  useEffect(() => {
    const saved = window.localStorage.getItem("access:dock-side");
    document.documentElement.dataset.dock =
      saved === "right" ? "right" : "left";
    const form = window.localStorage.getItem("access:rail-form");
    document.documentElement.dataset.railForm =
      form === "row" || form === "col" ? form : "grid";
  }, []);

  const setDockSide = (side: "left" | "right") => {
    const root = document.documentElement;
    const prev = root.dataset.dock === "right" ? "right" : "left";
    // released on the side it already sits on: nothing to animate
    if (prev === side) return;
    // the arc we're leaving collapses into a ball, runs the top edge, and
    // reforms at the other corner; the corner arcs hand over as it lands
    const leavingArc = prev === "left" ? "right" : "left";
    const nav = document.querySelector<HTMLElement>(".navbar-mobile");
    const grip = nav?.querySelector<HTMLElement>(
      `.nav-grip[data-arc="${leavingArc}"]`
    );

    // Everything in ONE task with no intermediate reflow: the dock change
    // must share the frame with `nav-switching`, otherwise the opacity
    // hand-over commits early and the leaving arc fades before it can run.
    nav?.querySelectorAll(".nav-grip").forEach((n) => {
      n.classList.remove("leaving");
    });
    nav?.classList.add("nav-switching");
    grip?.classList.add("leaving");

    // the ball itself: a real element animated here (Web Animations) so it
    // doesn't depend on the Chromium-only `d` path morph. It runs from the
    // leaving arc's top end to the arriving one's.
    const bead = nav?.querySelector<HTMLElement>(".nav-grip-bead");
    if (bead && nav) {
      const w = nav.getBoundingClientRect().width;
      const rightX = w - 26.5;
      const leftX = 21.5;
      bead.animate(
        [
          { left: `${leavingArc === "right" ? rightX : leftX}px`, opacity: 0, offset: 0 },
          { opacity: 1, offset: 0.14 },
          { opacity: 1, offset: 0.86 },
          { left: `${leavingArc === "right" ? leftX : rightX}px`, opacity: 0, offset: 1 },
        ],
        { duration: 850, easing: "cubic-bezier(0.4, 0, 0.2, 1)" }
      );
    }

    root.dataset.dock = side;
    window.localStorage.setItem("access:dock-side", side);

    window.setTimeout(() => {
      nav?.classList.remove("nav-switching");
      grip?.classList.remove("leaving");
    }, 1150);
  };

  // The edge handle resizes the rail like a real grip: both axes follow the
  // pointer freely, and on release the rail snaps to whichever form factor
  // that shape is closest to (square -> 2x2, wide -> 4x1, tall -> 1x4).
  const railFormDrag = useRef<{
    x: number;
    y: number;
    w: number;
    h: number;
    outward: 1 | -1;
  } | null>(null);

  const handleFormPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    // resizing is only for adjusting the rail, never while a panel is open
    if (!isFolded || activeItem) return;
    e.stopPropagation(); // don't also start the rail's move-drag
    const nav = e.currentTarget.closest<HTMLElement>(".navbar-mobile");
    if (!nav) return;
    const rect = nav.getBoundingClientRect();
    railFormDrag.current = {
      x: e.clientX,
      y: e.clientY,
      w: rect.width,
      h: rect.height,
      // the handle sits on the inner-top corner: on a left dock "outward"
      // is to the right, on a right dock it's to the left
      outward: document.documentElement.dataset.dock === "right" ? -1 : 1,
    };
    nav.classList.add("rail-sizing");
    // pin the grip to the corner from the first frame, before any move
    nav.style.setProperty("--rail-w", `${rect.width}px`);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleFormPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = railFormDrag.current;
    if (!d) return;
    e.preventDefault();
    const nav = e.currentTarget.closest<HTMLElement>(".navbar-mobile");
    if (!nav) return;

    const maxW = Math.min(560, window.innerWidth / 2 - 32);
    const maxH = Math.min(560, window.innerHeight - 120);
    d.w = Math.max(83, Math.min(maxW, d.w + (e.clientX - d.x) * d.outward));
    d.h = Math.max(83, Math.min(maxH, d.h - (e.clientY - d.y)));
    d.x = e.clientX;
    d.y = e.clientY;

    nav.style.width = `${d.w}px`;
    nav.style.height = `${d.h}px`;
    // keep --rail-w in step so the grip stays glued to the corner (no
    // animation here — the lap only plays when the rail changes sides)
    nav.style.setProperty("--rail-w", `${d.w}px`);
  };

  const handleFormPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const d = railFormDrag.current;
    railFormDrag.current = null;
    if (!d) return;
    const nav = e.currentTarget.closest<HTMLElement>(".navbar-mobile");
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!nav) return;

    const form = formFromSize(d.w, d.h);
    // restore the transition first (this task), then hand sizing back to the
    // form rules on the next frame — changing them in the same task would
    // leave the browser without a transition-capable style, so it'd snap
    nav.classList.remove("rail-sizing");
    requestAnimationFrame(() => {
      nav.style.removeProperty("width");
      nav.style.removeProperty("height");
      nav.style.removeProperty("--rail-w");
      document.documentElement.dataset.railForm = form;
      window.localStorage.setItem("access:rail-form", form);
    });
  };

  const handleFormPointerCancel = (e: React.PointerEvent<HTMLElement>) => {
    railFormDrag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const nav = e.currentTarget.closest<HTMLElement>(".navbar-mobile");
    if (!nav) return;
    nav.classList.remove("rail-sizing");
    nav.style.removeProperty("width");
    nav.style.removeProperty("height");
    nav.style.removeProperty("--rail-w");
  };

  // Drag the rail freely around: it follows the pointer on both axes, then
  // snaps to whichever side it was released on (persisted), easing back to
  // the bottom rail. A drag swallows the click it ends on.
  const dockDrag = useRef<{ startX: number; startY: number; moved: boolean } | null>(
    null
  );
  const dockWasDragged = useRef(false);

  const handleDockPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    // moving the rail is also only for adjusting it, not while open
    if (!isFolded || activeItem) return;
    dockDrag.current = { startX: e.clientX, startY: e.clientY, moved: false };
  };

  const handleDockPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dockDrag.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    // small dead zone so a tap still behaves like a tap
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    const el = e.currentTarget;
    if (!drag.moved) {
      drag.moved = true;
      el.classList.add("dock-dragging");
      el.setPointerCapture(e.pointerId);
    }
    // belt-and-braces against the browser starting a scroll mid-drag
    e.preventDefault();
    el.style.setProperty("--dock-drag", `${dx}px ${dy}px`);
  };

  // A canceled gesture (or the browser stealing it) must drop the drag
  // state, or the rail would stay offset with no pointer to follow.
  const handleDockPointerCancel = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dockDrag.current;
    dockDrag.current = null;
    if (!drag) return;
    const el = e.currentTarget;
    el.classList.remove("dock-dragging");
    el.style.removeProperty("--dock-drag");
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  const handleDockPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dockDrag.current;
    dockDrag.current = null;
    if (!drag) return;
    const el = e.currentTarget;
    if (!drag.moved) return; // a tap, not a drag

    // measure while the drag offset still applies, then snap to the half
    // it was released on
    const rect = el.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    el.classList.remove("dock-dragging");
    el.style.removeProperty("--dock-drag");
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    dockWasDragged.current = true;
    const next = center < window.innerWidth / 2 ? "left" : "right";
    // Hand the snap to the next frame: the drag class (`transition: none`)
    // was just removed, and changing the side in the same task means the
    // browser never sees a transition-capable style, so it would jump.
    requestAnimationFrame(() => setDockSide(next));
  };

  const handleDockClickCapture = (e: React.MouseEvent) => {
    if (dockWasDragged.current) {
      e.preventDefault();
      e.stopPropagation();
      dockWasDragged.current = false;
    }
  };

  // The open nav item, if any — its submenu fills the folded nav pad.
  // (Plain lookup: a 4-item find doesn't need memoization, and the React
  // Compiler can't preserve a manual memo across the imperative drag code.)
  const activeItem = NAV_CONFIG.find((item) => item.id === activeDropdown) ?? null;

  const toggleDropdown = (dropdownName: string) => {
    if (activeDropdown === dropdownName) {
      // Closing dropdown
      setActiveDropdown(null);
      setIsFocusMode(false);
    } else {
      // Opening dropdown
      setActiveDropdown(dropdownName);
      setIsFocusMode(true);
      setIsLoginExpanded(false); // Close login pill when opening dropdown
    }
  };

  const toggleLogin = () => {
    if (isLoginExpanded) {
      setIsLoginExpanded(false);
    } else {
      setIsLoginExpanded(true);
      setActiveDropdown(null); // Close any active dropdowns
      setIsFocusMode(false);
    }
  };

  // The popup is portaled to <body>, so its position must track the
  // pill's live spot (desktop pill is in the centered cluster, mobile
  // pill is pinned top-right). Align the popup's right edge with the
  // pill's right edge, 12px below it.
  const popupRef = useRef<HTMLDivElement | null>(null);
  // Layout effect: reposition before first paint so the entrance
  // animation plays from the aligned spot, not the CSS fallback.
  // Runs client-only (the popup mounts only on open).
  useLayoutEffect(() => {
    if (!isLoginExpanded) return;
    const pill = loginRef.current?.getBoundingClientRect();
    const popup = popupRef.current;
    if (!pill || !popup) return;
    popup.style.top = `${pill.bottom + 12}px`;
    popup.style.right = `${window.innerWidth - pill.right}px`;
  }, [isLoginExpanded]);

  // Shared nav items — rendered by both the desktop pill and the mobile
  // bottom bar (CSS shows exactly one via media queries).
  const navItems = NAV_CONFIG.map((item) => {
    // Check officer requirements
    if (item.requiresOfficer && (!isOfficer || !officerChecked)) return null;

    if (item.isDropdown) {
      return (
        <NavbarDropdownTrigger
          key={item.id}
          item={item}
          isActive={activeDropdown === item.id}
          isFocusMode={isFocusMode}
          toggleDropdown={toggleDropdown}
        />
      );
    } else {
      return (
        <NavbarLink
          key={item.id}
          item={item}
          isFocusMode={isFocusMode}
        />
      );
    }
  });

  return (
    <>
      {/* Error notification for authentication failures */}
      {authError && (
        <div className="auth-error-notification">
          <AlertCircle className="w-5 h-5" aria-hidden />
          <span>{authError}</span>
          <button
            onClick={() => setAuthError(null)}
            className="auth-error-close"
            aria-label="Close notification"
          >
            ×
          </button>
        </div>
      )}

      {/* Header Wrapper to center Navbar and Pill together */}
      <div className={`header-wrapper ${isVisible ? "header-visible" : "header-hidden"}`}>
        <div ref={logoRef} className={`logo-container header-element ${isVisible && !isCompressed ? "header-visible" : "header-hidden"}`}>
          <div className="logo-pill">
            <Link
              href="/"
              aria-label="Home"
              className="flex items-center gap-2 h-full px-5"
            >
              <span className="flex items-center gap-2">
                <Image
                  src="/logo/access.svg"
                  alt="ACCESS DLSU Logo"
                  width={24}
                  height={24}
                  priority
                  className="h-6 w-6 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
                />
                <span className="brand-text text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                  ACCESS
                </span>
              </span>
            </Link>
          </div>
        </div>

        {/* Desktop navbar pill — slides up and out below 1200px */}
        <div
          className={`navbar ${isCompressed ? "navbar-compressed" : ""} ${isFocusMode ? "navbar-focus-mode" : ""} ${revealInstant ? "navbar-no-compress-transition" : ""}`}
        >
          <div className="navbar-content">
            {/* Compressed trigger - only visible when compressed and not expanded */}
            <button
              className="navbar-trigger"
              onClick={handleCompressedClick}
              aria-label="Toggle navigation menu"
            >
              <Menu className="w-4 h-4" aria-hidden />
              <span className="navbar-label">Navigation Bar</span>
            </button>

            {/* Navigation links - dynamically generated from config */}
            <nav className="navbar-links">
              {navItems}
            </nav>
          </div>
        </div>

        <div
          ref={loginRef}
          className={`login-container ${authLoading || session ? "logged-in" : ""}`}
        >
          <div
            className={`login-pill ${isLoginExpanded ? "expanded" : ""}`}
          >
            <div
              className="login-trigger"
              onClick={(e) => {
                e.stopPropagation(); // Prevent document click handler
                toggleLogin();
              }}
            >
              {authLoading ? (
                // Session still resolving (SSR included): show the
                // generic avatar circle — same 60px shape as the
                // logged-in pill, so signed-in users get a plain
                // icon->image swap with no pill morph.
                <UserCircle className="w-5 h-5 profile-fallback" aria-hidden />
              ) : session ? (
                // Show profile picture when logged in, X when expanded
                isLoginExpanded ? (
                  <span className="close-icon-wrapper">
                    <X className="w-7 h-7 close-icon" aria-hidden />
                  </span>
                ) : (
                  <>
                    {session.user?.image ? (
                      <Image
                        src={session.user.image}
                        alt={session.user?.name || "User"}
                        width={48}
                        height={48}
                        loading="eager"
                        className="profile-picture"
                        onError={(e) => {
                          // Fallback to UserCircle icon if image fails to load
                          e.currentTarget.style.display = "none";
                          const fallback = e.currentTarget
                            .nextElementSibling as HTMLElement;
                          if (fallback) fallback.style.display = "block";
                        }}
                      />
                    ) : null}
                    <UserCircle
                      className="w-5 h-5 profile-fallback"
                      aria-hidden
                      style={{ display: session.user?.image ? "none" : "block" }}
                    />
                  </>
                )
              ) : (
                // Show lock icon when not logged in
                // Check if expanded to show Close button
                isLoginExpanded ? (
                  <>
                    <X className="w-4 h-4" aria-hidden />
                    <span>Close</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" aria-hidden />
                    <span>Login</span>
                  </>
                )
              )}
            </div>

            {isLoginExpanded &&
          createPortal(
            <div className="login-expanded" ref={popupRef}>
              <div className="login-expanded-content">
                {session ? (
                  // Logged in state
                  <>
                    <div className="profile-header">
                      {session.user?.image ? (
                        <Image
                          src={session.user.image}
                          alt={session.user?.name || "User"}
                          width={80}
                          height={80}
                          className="profile-picture-large"
                        />
                      ) : (
                        <UserCircle
                          className="w-20 h-20 profile-fallback-large"
                          aria-hidden
                        />
                      )}
                      <h3 className="profile-name">{session.user?.name}</h3>
                      <p className="profile-email">{session.user?.email}</p>
                    </div>

                    <div className="login-expanded-footer">
                        <button
                            className="google-signin-button signout-button btn-red"
                            onClick={() => signOut()}
                        >
                            <LogOut className="w-5 h-5" aria-hidden />
                            Sign out
                        </button>
                    </div>
                  </>
                ) : (
                  // Logged out state
                  <>
                    <div className="login-header">
                      <Lock className="w-5 h-5" aria-hidden />
                      <h3>Member Login</h3>
                    </div>

                    <p className="login-description">
                      Sign in with your <strong>@dlsu.edu.ph</strong> email to
                      access exclusive resources and connect with the community.
                    </p>

                    <button
                      className="google-signin-button"
                      onClick={() => signIn("google")}
                      disabled={status === "loading"}
                    >
                      <svg
                        className="google-icon"
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                      >
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                      {status === "loading"
                        ? "Loading..."
                        : "Sign in with Google"}
                    </button>

                    <div className="login-perks">
                      <div className="perk-item">
                        <BookOpen className="w-4 h-4 perk-icon-svg" aria-hidden />
                        <span>Access learning materials</span>
                      </div>
                      <div className="perk-item">
                        <UserCircle
                          className="w-4 h-4 perk-icon-svg"
                          aria-hidden
                        />
                        <span>Alumni Directory</span>
                      </div>
                      <div className="perk-item">
                        <Trophy className="w-4 h-4 perk-icon-svg" aria-hidden />
                        <span>Challenges</span>
                      </div>
                      <div className="perk-item">
                        <Bot className="w-4 h-4 perk-icon-svg" aria-hidden />
                        <span>Ace The Assistant</span>
                      </div>
                      <div className="perk-item">
                        <FileText className="w-4 h-4 perk-icon-svg" aria-hidden />
                        <span>Blog Post</span>
                      </div>
                      <div className="perk-item">
                        <Plus className="w-4 h-4 perk-icon-svg" aria-hidden />
                        <span>More to Come Soon...</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>,
            document.body
          )}
          </div>
        </div>
      </div>

      {/* Mobile bottom bar — outside the wrapper so position:fixed always
          anchors to the viewport (the wrapper's centering transform would
          otherwise become its containing block). In the folded posture it
          morphs: the square pad becomes the focused item's submenu panel,
          with that item's tile docked bottom-right as the handle. */}
      <nav
        className={`navbar-mobile ${isVisible ? "bar-visible" : "bar-hidden"} ${isFolded && activeItem ? "nav-open" : ""}`}
        aria-label="Mobile navigation"
        onPointerDown={handleDockPointerDown}
        onPointerMove={handleDockPointerMove}
        onPointerUp={handleDockPointerUp}
        onPointerCancel={handleDockPointerCancel}
        onClickCapture={handleDockClickCapture}
      >
        {/* Corner grips: one arc per top corner. Only the inner-top corner
            is shown for the current dock (top-right when docked left,
            top-left when docked right); changing sides runs a bead along the
            top edge and the arcs hand over when it lands. */}
        {(["left", "right"] as const).map((arc) => (
          <span key={arc} className="nav-grip" data-arc={arc} aria-hidden>
            <svg className="nav-grip-arc" viewBox="0 0 100 100">
              <path
                d="M 51.7 34.1 A 16 16 0 0 1 65.9 48.3"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <span
              className="nav-grip-hit"
              onPointerDown={handleFormPointerDown}
              onPointerMove={handleFormPointerMove}
              onPointerUp={handleFormPointerUp}
              onPointerCancel={handleFormPointerCancel}
            />
          </span>
        ))}
        {/* the ball that runs the top edge on a side change */}
        <span className="nav-grip-bead" aria-hidden />

        {/* Shown only while the grip is being dragged. */}
        <span className="navbar-resizing" aria-hidden>
          <Maximize2 className="w-5 h-5" aria-hidden />
          <span>Resizing</span>
        </span>
        {isFolded ? (
          <div className="navbar-panel">
            {activeItem ? (
              <DropdownMenu
                item={activeItem}
                activeDropdown={activeDropdown}
                isCompressed={isCompressed}
                inline
              />
            ) : null}
          </div>
        ) : null}
        <div className="navbar-content">
          <div className="navbar-links">{navItems}</div>
        </div>
      </nav>

      {/* Floating dropdown — the desktop pill's menu. Folded devices use
          the inline panel above instead, so nothing floats there. */}
      {!isFolded &&
        NAV_CONFIG.map((item) => (
          <DropdownMenu
            key={item.id}
            item={item}
            activeDropdown={activeDropdown}
            isCompressed={isCompressed}
          />
        ))}
    </>
  );
}

export default function Header() {
  const [authError, setAuthError] = useState<string | null>(null);

  return (
    <>
      <Suspense fallback={null}>
        <AuthErrorHandler onAuthError={setAuthError} />
      </Suspense>
      <HeaderContent authError={authError} setAuthError={setAuthError} />
    </>
  );
}
