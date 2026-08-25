import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

const DISMISSED_KEY = "sweatsalt-install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

// Chrome/Edge/Android fire `beforeinstallprompt` and let us trigger the
// native install dialog directly. iOS Safari never fires that event and
// has no programmatic install API at all — "Add to Home Screen" only
// exists inside the Share sheet, so that path can only ever be
// instructions, never a button.
export function InstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY) === "1");
  const [iosVisible, setIosVisible] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (isStandalone() || dismissed) return;

    if (isIos()) {
      setIosVisible(true);
      return;
    }

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, [dismissed]);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
    setDeferredEvent(null);
    setIosVisible(false);
  }

  async function install() {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    const { outcome } = await deferredEvent.userChoice;
    if (outcome === "accepted") dismiss();
    else setDeferredEvent(null);
  }

  const visible = !dismissed && (deferredEvent !== null || iosVisible);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="bg-surface border-hairline fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-sm items-center gap-3 rounded-2xl rounded-tl-none border px-4 py-3 shadow-lg"
          data-testid="install-prompt"
          initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={{ duration: 0.25 }}
        >
          <div className="flex-1 font-sans text-sm text-white/85">
            {iosVisible ? (
              <>
                Install SweatSalt: tap <span className="font-semibold">Share</span>, then{" "}
                <span className="font-semibold">Add to Home Screen</span>.
              </>
            ) : (
              "Install SweatSalt on this device for one-tap access."
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!iosVisible && (
              <button
                type="button"
                onClick={install}
                className="rounded-full px-3 py-1.5 font-sans text-xs font-semibold text-white"
                style={{ background: "var(--color-accent)" }}
              >
                Install
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="font-sans text-xs text-white/45 underline decoration-white/20 underline-offset-2"
            >
              {iosVisible ? "Got it" : "Not now"}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
