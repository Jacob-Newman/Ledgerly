import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole, Mail, UserPlus } from "lucide-react";
import { supabase } from "./lib/supabase";

export function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    if (mode === "sign-up" && !result.data.session) {
      setMessage("Check your email to confirm your account, then sign in.");
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-mark"><LockKeyhole size={21} /></div>
        <span className="eyebrow">PRIVATE BUDGET WORKSPACE</span>
        <h1 id="auth-title">{mode === "sign-in" ? "Welcome back" : "Create your workspace"}</h1>
        <p>
          {mode === "sign-in"
            ? "Sign in to view your saved statements and spending history."
            : "Your Ledgerly data is private to your account."}
        </p>
        <form onSubmit={submit} className="auth-form">
          <label>
            Email
            <span className="auth-input"><Mail size={17} /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></span>
          </label>
          <label>
            Password
            <span className="auth-input"><LockKeyhole size={17} /><input type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required /></span>
          </label>
          {error && <p className="auth-feedback error">{error}</p>}
          {message && <p className="auth-feedback">{message}</p>}
          <button className="auth-submit" disabled={busy} type="submit">
            {mode === "sign-in" ? <ArrowRight size={18} /> : <UserPlus size={18} />}
            {busy ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button className="auth-switch" type="button" onClick={() => { setMode((current) => current === "sign-in" ? "sign-up" : "sign-in"); setError(null); setMessage(null); }}>
          {mode === "sign-in" ? "New to Ledgerly? Create an account" : "Already have an account? Sign in"}
        </button>
      </section>
    </main>
  );
}
