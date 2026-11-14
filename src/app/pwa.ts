import { $ } from "./ui.ts";

/** The non-standard install prompt event (Chromium browsers). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Announce = (message: string) => void;

function isStandalone(): boolean {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const canPopover = "showPopover" in HTMLElement.prototype;

/**
 * A small toast above the toolbar for "offline ready" and "update" notices. While a modal dialog
 * is open the rest of the page is inert, so the toast waits until it closes.
 */
function createToast(announce: Announce) {
  const el = $("pwa-toast");
  const text = $("pwa-text");
  const action = $<HTMLButtonElement>("pwa-action");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: (() => void) | undefined;
  let onAction: (() => void) | undefined;
  action.addEventListener("click", () => onAction?.());

  const hide = () => {
    clearTimeout(timer);
    if (canPopover) {
      if (el.matches(":popover-open")) el.hidePopover();
    } else el.classList.remove("open");
  };
  $("pwa-close").addEventListener("click", hide);

  // `close` doesn't bubble, so listen in the capture phase; a dialog may reopen right after.
  document.addEventListener(
    "close",
    () =>
      setTimeout(() => {
        if (pending && !document.querySelector("dialog:modal")) {
          const show = pending;
          pending = undefined;
          show();
        }
      }),
    true,
  );

  return (message: string, act?: { label: string; run: () => void }, ms = 0) => {
    const show = () => {
      text.textContent = message;
      action.hidden = !act;
      if (act) {
        action.textContent = act.label;
        onAction = act.run;
      }
      hide();
      if (canPopover) el.showPopover();
      else el.classList.add("open");
      announce(act ? `${message} ${act.label} is available.` : message);
      if (ms) timer = setTimeout(hide, ms);
    };
    if (document.querySelector("dialog:modal")) pending = show;
    else show();
  };
}

interface SwHandlers {
  /** A new version is installed and waiting; `update` tells it to take over (the page reloads). */
  onNeedRefresh(update: () => void): void;
  /** The first install finished: everything is cached for offline use. */
  onOfflineReady(): void;
  onRegistered(registration: ServiceWorkerRegistration): void;
}

/**
 * Registers `sw.js` with workbox-window, "prompt" style: a new version waits until `update` is
 * called, then the page reloads once it takes control. workbox-window loads lazily, after the app.
 */
async function registerServiceWorker(on: SwHandlers): Promise<void> {
  const { Workbox } = await import("@vite-pwa/workbox-window");
  const wb = new Workbox("./sw.js", { scope: "./", type: "classic" });
  let needRefresh = false;
  const showUpdate = () => {
    if (!needRefresh) {
      needRefresh = true;
      wb.addEventListener("controlling", (e) => {
        if (e.isUpdate) location.reload();
      });
    }
    on.onNeedRefresh(() => wb.messageSkipWaiting());
  };
  wb.addEventListener("waiting", showUpdate);
  wb.addEventListener("installed", (e) => {
    // A worker installed by another tab (isExternal) is an update this page didn't see coming.
    if (e.isExternal) showUpdate();
    else if (!e.isUpdate && !needRefresh) on.onOfflineReady();
  });
  const registration = await wb.register({ immediate: false });
  if (registration) on.onRegistered(registration);
}

/**
 * Registers the service worker (offline support) and wires up the install and update prompts.
 * Updates never apply on their own: the user chooses "Update" when it suits them, so a new version
 * can't reload the page and interrupt a run mid-build.
 */
export function setupPwa(announce: Announce): void {
  if (!("serviceWorker" in navigator)) return;
  const toast = createToast(announce);

  // The dev server builds no service worker, so only production builds register one.
  if (import.meta.env.PROD) {
    registerServiceWorker({
      onNeedRefresh(update) {
        // The toast is a shortcut; the top bar keeps offering the update after it's dismissed.
        const updateButton = $<HTMLButtonElement>("update");
        updateButton.addEventListener("click", update, { once: true });
        updateButton.hidden = false;
        // On narrow screens the button sits in the "More" menu, so flag the menu button too.
        document.querySelector<HTMLElement>(".update-dot")!.hidden = false;
        $("more").setAttribute("aria-label", "More actions, update available");
        toast("A new version of Marble Run is ready.", { label: "Update", run: update });
      },
      onOfflineReady() {
        toast("Ready to work offline.", undefined, 4000);
      },
      onRegistered(registration) {
        // Browsers only look for a new service worker on navigation, and an installed app can
        // stay open for a long time. Check on startup, on returning to the app, and hourly.
        const check = () => {
          // Skip while the first install is still in progress; there's nothing to update yet.
          if (navigator.onLine && registration.active && !registration.installing) {
            registration.update().catch(() => {});
          }
        };
        check();
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
        setInterval(check, 60 * 60 * 1000);
      },
    }).catch((error: unknown) => console.error("Service worker registration failed", error));
  }

  installPrompt();
}

function installPrompt(): void {
  // The Web Install API (navigator.install) is preferred; Chromium's beforeinstallprompt is the
  // fallback. The button stays hidden unless one of them can install.
  const nav = navigator as Navigator & { install?: () => Promise<void> };
  const webInstall = typeof nav.install === "function";
  let deferred: BeforeInstallPromptEvent | undefined;
  const installButton = $<HTMLButtonElement>("install");
  if (webInstall && !isStandalone()) installButton.hidden = false;
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    if (!webInstall) installButton.hidden = false;
  });
  installButton.addEventListener("click", async () => {
    if (installButton.getAttribute("aria-disabled") === "true") return;
    // aria-disabled rather than disabled, so focus isn't dropped while the browser's dialog is up.
    installButton.setAttribute("aria-disabled", "true");
    try {
      if (webInstall) {
        // Called straight from the click handler so it keeps the user activation it needs.
        await nav.install!();
        installButton.hidden = true;
      } else if (deferred) {
        // The event is single-use: drop it before awaiting the choice.
        const prompt = deferred;
        deferred = undefined;
        await prompt.prompt();
        await prompt.userChoice;
        if (!deferred) installButton.hidden = true;
      }
    } catch (error) {
      // AbortError is the user cancelling; keep the button so they can try again.
      if ((error as DOMException).name !== "AbortError") console.error(error);
    } finally {
      installButton.removeAttribute("aria-disabled");
    }
  });
  addEventListener("appinstalled", () => {
    installButton.hidden = true;
    deferred = undefined;
  });

  // iOS Safari has no install prompt: explain the Share-sheet route in the help dialog instead.
  const ios =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios && !isStandalone()) $("ios-hint").hidden = false;
}
