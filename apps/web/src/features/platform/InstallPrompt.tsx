import React from "react";

interface InstallChoice {
  outcome: "accepted" | "dismissed";
  platform: string;
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
}

const DISMISS_KEY = "nerloq-install-dismissed-at";
const DISMISS_DAYS = 7;

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true);
}

function wasRecentlyDismissed(): boolean {
  try {
    const value = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(value) && value > 0 &&
      Date.now() - value < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function InstallPrompt(): React.JSX.Element | null {
  const [visible, setVisible] = React.useState(false);
  const [help, setHelp] = React.useState(false);
  const [installing, setInstalling] = React.useState(false);
  const deferred = React.useRef<InstallPromptEvent | null>(null);

  React.useEffect(() => {
    if (isStandalone() || wasRecentlyDismissed()) return;

    let timer: number | undefined;

    const show = () => {
      timer = window.setTimeout(() => setVisible(true), 3500);
    };

    const onInstallAvailable = (event: Event) => {
      event.preventDefault();
      deferred.current = event as InstallPromptEvent;
      setVisible(true);
    };

    const onInstalled = () => {
      setVisible(false);
      setHelp(false);
      deferred.current = null;
    };

    show();
    window.addEventListener("beforeinstallprompt", onInstallAvailable);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onInstallAvailable);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    setHelp(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // The prompt remains dismissible if storage is unavailable.
    }
  };

  const install = async () => {
    const event = deferred.current;
    if (!event) {
      setHelp(true);
      return;
    }

    setInstalling(true);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      deferred.current = null;
      if (choice.outcome === "accepted") {
        setVisible(false);
      } else {
        dismiss();
      }
    } catch {
      setHelp(true);
    } finally {
      setInstalling(false);
    }
  };

  if (!visible) return null;

  return (
    <aside className="nerloq-install" aria-label="Install NERLOQ">
      <div className="nerloq-install-icon" aria-hidden="true">N</div>
      <div className="nerloq-install-copy">
        <strong>Take NERLOQ with you</strong>
        <span>Install the app for a quick, app-like experience.</span>
        {help && (
          <span className="nerloq-install-help" role="status">
            In your browser menu, choose “Install app” or “Add to Home screen” if available.
          </span>
        )}
      </div>
      <div className="nerloq-install-actions">
        <button type="button" onClick={install} disabled={installing}>
          {installing ? "Opening…" : "Install"}
        </button>
        <button type="button" className="nerloq-install-dismiss" onClick={dismiss} aria-label="Dismiss installation prompt">
          Not now
        </button>
      </div>
    </aside>
  );
}
