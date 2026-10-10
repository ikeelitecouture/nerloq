import React from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, KeyRound, Mail, UserRound } from "lucide-react";
import { useAuth } from "./AuthContext";

type Mode = "login" | "register";

export function AuthScreen({ mode }: { readonly mode: Mode }): React.JSX.Element {
  const { state, signIn, register } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [passwordValue, setPasswordValue] = React.useState("");

  if (state.status === "loading") return <div className="boot-screen">Opening your NERLOQ space…</div>;
  if (state.status === "signed-in") return <Navigate to="/home" replace />;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      if (mode === "login") {
        await signIn(String(form.get("identifier")), String(form.get("password")));
      } else {
        await register({
          displayName: String(form.get("displayName")),
          username: String(form.get("username")),
          email: String(form.get("email")),
          password: String(form.get("password")),
        });
      }
      navigate("/home", { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not complete that request.");
    } finally {
      setBusy(false);
    }
  }

  const registering = mode === "register";
  return (
    <main className="auth-layout" id="main-content" tabIndex={-1}>
      <section className="auth-story" aria-label="NERLOQ introduction">
        <Link to="/" className="brand-lockup" aria-label="NERLOQ home">
          <span className="brand-mark"><img src="/nerloq.png" alt="" /></span>
          <span className="brand-name">NERLOQ</span>
        </Link>
        <div className="story-copy">
          <span className="overline"><span className="live-dot" /> A new frame for what’s next</span>
          <h1>Make room<br />for <em>your point</em><br />of view.</h1>
          <p>Video is how we see the world through each other. Bring yours into focus.</p>
        </div>
        <div className="story-footer"><span>Create.</span><span>Connect.</span><span>Discover.</span></div>
        <div className="story-orbit story-orbit--one" /><div className="story-orbit story-orbit--two" />
      </section>

      <section className="auth-panel">
        <div className="auth-panel-top"><span>YOUR NEXT CHAPTER</span><span>01 / 03</span></div>
        <div className="auth-form-wrap">
          <div className="auth-heading">
            <span className="auth-kicker">{registering ? "START HERE" : "WELCOME BACK"}</span>
            <h2>{registering ? "Find your people." : "Good to see you."}</h2>
            <p>{registering ? "Create a space for the things you want to share." : "Step back into the stories you’re part of."}</p>
          </div>
          <form className="auth-form" onSubmit={handleSubmit} aria-busy={busy}>
            {registering && <>
              <label className="field"><span>Your name</span><span className="field-input"><UserRound size={18} /><input name="displayName" autoComplete="name" minLength={1} maxLength={80} placeholder="How should we call you?" autoFocus required /></span></label>
              <label className="field"><span>Username <small>LET PEOPLE FIND YOU</small></span><span className="field-input"><span className="field-prefix">@</span><input name="username" autoComplete="username" minLength={3} maxLength={30} pattern="[A-Za-z0-9._]+" placeholder="yourcorner" required /></span></label>
            </>}
            <label className="field"><span>{registering ? "Email address" : "Email or username"}</span><span className="field-input"><Mail size={18} /><input name={registering ? "email" : "identifier"} type={registering ? "email" : "text"} autoComplete={registering ? "email" : "username"} maxLength={254} placeholder={registering ? "you@example.com" : "Where should we find you?"} autoFocus={!registering} required /></span></label>
            <label className="field"><span>Password</span><span className="field-input"><KeyRound size={18} /><input name="password" type={showPassword ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 12 : 1} maxLength={128} placeholder={registering ? "At least 12 characters" : "Your password"} value={passwordValue} onChange={event => setPasswordValue(event.target.value)} required /><button type="button" className="reveal-button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
            {registering && (
                          <div className="password-requirements" aria-live="polite">
                            <p>Password requirements</p>
                            {[
                              ["At least 12 characters", passwordValue.length >= 12],
                              ["One uppercase letter (A–Z)", /[A-Z]/.test(passwordValue)],
                              ["One lowercase letter (a–z)", /[a-z]/.test(passwordValue)],
                              ["One number (0–9)", /\d/.test(passwordValue)],
                              ["One special character (!@#…)", /[^A-Za-z0-9]/.test(passwordValue)],
                            ].map(([label, passed]) => (
                              <div key={String(label)} className={passed ? "password-check password-check--valid" : "password-check"}>
                                <span aria-hidden="true">{passed ? "✓" : "○"}</span>
                                <span>{label}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {error && <p className="form-error" id="auth-error" role="alert">{error}</p>}
            <button className="submit-button" type="submit" disabled={busy} aria-busy={busy}>{busy ? "One moment…" : registering ? "Create your account" : "Continue to NERLOQ"}<ArrowRight size={18} /></button>
          </form>
          {!registering&&<p className="auth-switch"><Link to="/forgot-password">Forgot your password?</Link></p>}
          <p className="auth-switch">{registering ? "Already have a place here?" : "New to NERLOQ?"} <Link to={registering ? "/login" : "/join"}>{registering ? "Sign in" : "Create an account"}</Link></p>
          <p className="legal-note">By continuing, you agree to use this space with care and respect for the people in it.</p>
        </div>
        <div className="auth-panel-bottom"><span>NERLOQ · 2026</span><span>Built for the stories between us</span></div>
      </section>
    </main>
  );
}
