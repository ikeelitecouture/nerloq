import React from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ArrowUpRight, Check, ExternalLink, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { resolveMediaUrl } from "../../lib/api";

export function ProfileScreen(): React.JSX.Element {
  const { state, updateProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  if (state.status === "loading") return <div className="boot-screen">Opening your NERLOQ space…</div>;
  if (state.status !== "signed-in") return <Navigate to="/login" replace />;
  const { user } = state;

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    setError("");
    setBusy(true);
    const values = new FormData(event.currentTarget);
    const website = String(values.get("websiteUrl") ?? "").trim();
    try {
      await updateProfile({
        username: String(values.get("username") ?? "").trim(),
        displayName: String(values.get("displayName")),
        bio: String(values.get("bio")),
        websiteUrl: website || null,
        isPrivate: values.get("isPrivate") === "on",
      });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <main className="profile-app" id="main-content" tabIndex={-1}>
      <header className="app-topbar">
        <Link to="/profile" className="brand-lockup"><span className="brand-mark"><img src="/nerloq.png" alt="" /></span><span className="brand-name">NERLOQ</span></Link>
        <div className="topbar-right"><span className="topbar-note">YOUR SPACE</span><button className="text-action" onClick={() => void handleSignOut()} disabled={signingOut}><LogOut size={16} /> {signingOut ? "Signing out…" : "Sign out"}</button></div>
      </header>

      <div className="profile-page">
        <div className="page-intro"><div><span className="auth-kicker">ACCOUNT / PROFILE</span><h1>Your space,<br className="mobile-break" /> in focus.</h1></div><span className="intro-index">01 — 04</span></div>

        <section className="profile-card">
          <div className="profile-card-heading"><span>THE PERSON BEHIND THE FRAME</span><span className="profile-status">ACCOUNT</span></div>
          <div className="identity-block">
             <div className="avatar-frame" aria-label={`${user.displayName}'s avatar`}><div className="avatar-orbit" />{user.avatarUrl ? <img src={resolveMediaUrl(user.avatarUrl)} alt=""/> : <span>{user.displayName.slice(0, 1).toUpperCase()}</span>}</div>
            <div className="identity-copy"><div className="identity-name">{user.displayName}{user.verified && <Check className="verified-icon" size={17} />}</div><div className="identity-handle">@{user.username}</div><p>{user.bio || "Your point of view starts here."}</p></div>

          </div>
          <div className="profile-divider" />
          <div className="profile-lower">
            <div className="profile-aside"><span className="auth-kicker">YOUR DETAILS</span><p>Shape how people meet you. Your profile is the start of every connection.</p><div className="privacy-note"><ShieldCheck size={18} /><span>Your email stays private. You control what your profile shares.</span></div></div>
             <form className="profile-form" onSubmit={saveProfile} key={user.updatedAt} aria-busy={busy}>
              <div className="form-grid">
                <label className="field"><span>Display name</span><span className="field-input"><input name="displayName" defaultValue={user.displayName} maxLength={80} required /></span></label>
                <label className="field"><span>Username</span><span className="field-input"><span className="field-prefix">@</span><input name="username" defaultValue={user.username} aria-label="Username" autoCapitalize="none" autoCorrect="off" spellCheck={false} minLength={3} maxLength={30} pattern="[A-Za-z0-9._]+" title="Use 3–30 letters, numbers, dots or underscores." required /></span></label>
              </div>
              <label className="field"><span>Your bio <small>UP TO 500 CHARACTERS</small></span><span className="field-input field-textarea"><textarea name="bio" defaultValue={user.bio} maxLength={500} placeholder="What are you here to share?" rows={3} /></span></label>
              <label className="field"><span>Website <small>OPTIONAL</small></span><span className="field-input"><input name="websiteUrl" type="url" defaultValue={user.websiteUrl ?? ""} maxLength={2048} placeholder="https://" /></span></label>
              <label className="profile-privacy-toggle"><input name="isPrivate" type="checkbox" defaultChecked={user.isPrivate}/><span><strong>Private profile</strong><small>Only approved followers can view follower-only videos and community details.</small></span></label>
              {error && <p className="form-error" role="alert">{error}</p>}
              {saved && <p className="saved-message" role="status"><Check size={15} /> Changes saved to your profile.</p>}
               <div className="profile-form-footer"><span>Joined {new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(user.createdAt))}</span><div className="profile-form-actions"><Link className="quiet-action" to={`/u/${encodeURIComponent(user.username)}`}><ExternalLink size={15}/> View public profile</Link><button className="submit-button profile-save" type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}<ArrowUpRight size={17} /></button></div></div>
            </form>
          </div>
        </section>

        <footer className="profile-footer"><span>CREATE. CONNECT. DISCOVER.</span><span>YOUR STORY HAS ROOM HERE <b>↗</b></span></footer>
      </div>
    </main>
  );
}
