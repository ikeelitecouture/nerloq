import React from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, KeyRound, Mail } from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "./AuthContext";

export function RecoveryScreen({ reset = false }: { readonly reset?: boolean }): React.JSX.Element {
  const { state } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [complete, setComplete] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const token = params.get("token") ?? "";

  if (state.status === "loading") return <div className="boot-screen">Opening your NERLOQ space…</div>;
  if (state.status === "signed-in") return <Navigate to="/home" replace/>;
  if (reset && !token) return <Navigate to="/forgot-password" replace/>;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const values = new FormData(event.currentTarget);
    try {
      if (reset) { await api.resetPassword(token, String(values.get("password"))); }
      else { await api.requestPasswordReset(String(values.get("email"))); }
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be completed.");
    } finally { setBusy(false); }
  }

  return <main className="recovery-layout" id="main-content" tabIndex={-1}><section className="recovery-brand"><Link to="/" className="brand-lockup"><span className="brand-mark"><img src="/nerloq.png" alt="" /></span><span className="brand-name">NERLOQ</span></Link><div><span className="eyebrow">ACCOUNT ACCESS</span><h1>{reset ? "A safer way back." : "Find your way back."}</h1><p>Your account and the stories you keep are worth protecting.</p></div><span className="story-footer">CREATE. CONNECT. DISCOVER.</span></section><section className="recovery-panel"><span className="auth-kicker">{reset ? "SET A NEW PASSWORD" : "PASSWORD RECOVERY"}</span><h2>{complete ? reset ? "Password updated." : "Check your inbox." : reset ? "Choose a new password." : "Reset your password."}</h2><p>{complete ? reset ? "Your password has been changed. Sign in with the new one." : "If an account exists for that address, we’ve sent a one-time reset link." : reset ? "Use a strong password you have not used on NERLOQ before." : "Enter your account email and we’ll send a one-time reset link."}</p>{complete ? <button className="submit-button" onClick={() => navigate("/login", { replace: true })}>{reset ? "Continue to sign in" : "Back to sign in"}<ArrowRight size={17}/></button> : <form className="auth-form" onSubmit={submit} aria-busy={busy}>{reset ? <label className="field"><span>New password</span><span className="field-input"><KeyRound size={17}/><input name="password" type={showPassword ? "text" : "password"} minLength={12} maxLength={128} autoComplete="new-password" placeholder="At least 12 characters" autoFocus required/><button type="button" className="reveal-button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label> : <label className="field"><span>Email address</span><span className="field-input"><Mail size={17}/><input name="email" type="email" maxLength={254} autoComplete="email" placeholder="you@example.com" autoFocus required/></span></label>}{error && <p className="form-error" role="alert">{error}</p>}<button className="submit-button" disabled={busy} aria-busy={busy}>{busy ? "One moment…" : reset ? "Update password" : "Send reset link"}<ArrowRight size={17}/></button></form>}<p className="auth-switch"><Link to="/login">Return to sign in</Link></p></section></main>;
}
