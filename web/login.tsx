import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "./auth-client";
import { api } from "./lib";
import { Link } from "./ui";

export function Login({ initialMode }: { initialMode: "signIn" | "signUp" }) {
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    api<{ google: boolean }>("/api/auth-config")
      .then((c) => setGoogle(c.google))
      .catch((e) => setError(e.message));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } =
      mode === "signUp"
        ? await authClient.signUp.email({ name: name.trim(), email, password })
        : await authClient.signIn.email({ email, password });
    // On success the session hook re-renders the app at home; only failures land here.
    if (error) setError(error.message ?? "Something went wrong");
    else history.replaceState(null, "", "/");
    setBusy(false);
  }

  return (
    <main className="login">
      <h1>
        <Link to="/">Every human experience</Link>
      </h1>
      <p className="tagline">Rank everything that happens to you.</p>

      <form onSubmit={submit}>
        {mode === "signUp" && (
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        )}
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete={mode === "signUp" ? "new-password" : "current-password"}
        />
        <div className="actions">
          <button type="button" className="link quiet" onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}>
            {mode === "signIn" ? "Create an account" : "I have an account"}
          </button>
          <span className="spacer" />
          <button type="submit" className="link" disabled={busy}>
            {mode === "signIn" ? "Log in" : "Sign up"}
          </button>
        </div>
      </form>

      {google && (
        <button className="link google" onClick={() => authClient.signIn.social({ provider: "google", callbackURL: "/" })}>
          Continue with Google
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
