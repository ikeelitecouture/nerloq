import React from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "./features/auth/AuthProvider";
import { useAuth } from "./features/auth/AuthContext";
import { AuthScreen } from "./features/auth/AuthScreen";
import { RecoveryScreen } from "./features/auth/RecoveryScreen";
import { ProfileScreen } from "./features/profile/ProfileScreen";
import { PlatformScreen } from "./features/platform/PlatformScreen";
import { RealtimeProvider } from "./features/platform/RealtimeProvider";
import "./index.css";
import { InstallPrompt } from "./features/platform/InstallPrompt";

function HomeRedirect(): React.JSX.Element {
  const { state } = useAuth();
  if (state.status === "loading") return <div className="boot-screen">Opening your NERLOQ space…</div>;
  return <Navigate to={state.status === "signed-in" ? "/home" : "/join"} replace />;
}

function NotFoundScreen(): React.JSX.Element {
  const { state } = useAuth();
  if (state.status === "loading") return <div className="boot-screen">Opening your NERLOQ space…</div>;
  return <main className="app-crash" id="main-content" tabIndex={-1}><span className="eyebrow">FRAME NOT FOUND</span><h1>There is nothing here yet.</h1><p>The link may have moved, or the frame may no longer be available.</p><Link className="primary-action" to={state.status === "signed-in" ? "/home" : "/join"}>Return to NERLOQ</Link></main>;
}

function RouteFocus(): null {
  const location = useLocation();
  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [location.pathname, location.search]);
  return null;
}

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { readonly hasError: boolean }> {
  override state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <main className="app-crash" role="alert">
          <span className="eyebrow">UNEXPECTED FRAME</span>
          <h1>That view slipped out of focus.</h1>
          <p>NERLOQ could not finish rendering this screen. Reload to try again.</p>
          <button className="primary-action" onClick={() => window.location.reload()}>Reload NERLOQ</button>
        </main>
      );
    }
    return this.props.children;
  }
}

export default function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <InstallPrompt />
      <AuthProvider>
        <RealtimeProvider>
          <AppErrorBoundary>
            <RouteFocus />
            <Routes>
              <Route path="/" element={<HomeRedirect />} />
              <Route path="/join" element={<AuthScreen mode="register" />} />
              <Route path="/login" element={<AuthScreen mode="login" />} />
              <Route path="/forgot-password" element={<RecoveryScreen />} />
              <Route path="/reset-password" element={<RecoveryScreen reset />} />
              <Route path="/profile" element={<ProfileScreen />} />
              <Route path="/home" element={<PlatformScreen />} />
              <Route path="/discover" element={<PlatformScreen />} />
              <Route path="/following" element={<PlatformScreen />} />
              <Route path="/inbox" element={<PlatformScreen />} />
              <Route path="/notifications" element={<PlatformScreen />} />
              <Route path="/studio" element={<PlatformScreen />} />
              <Route path="/settings" element={<PlatformScreen />} />
              <Route path="/create" element={<PlatformScreen />} />
              <Route path="/search" element={<PlatformScreen />} />
              <Route path="/u/:username" element={<PlatformScreen />} />
              <Route path="/video/:videoId" element={<PlatformScreen />} />
              <Route path="/tag/:tag" element={<PlatformScreen />} />
              <Route path="*" element={<NotFoundScreen />} />
            </Routes>
          </AppErrorBoundary>
        </RealtimeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
