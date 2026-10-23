import { useEffect, useState, type FormEvent } from "react";
import { authClient, GROK_PROVIDERS, signIn } from "@/lib/auth/client";
import { getSignInOptions } from "@/lib/auth/sign-in-options";

// Off unless explicitly enabled: Google / X only work under Grok hosting.
const SOCIAL_SIGNIN = import.meta.env.VITE_SOCIAL_SIGNIN === "true";

export function SignInPanel() {
  const [mode, setMode] = useState<"in" | "up">("up");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [direct, setDirect] = useState<{ google: boolean; apple: boolean }>({ google: false, apple: false });

  useEffect(() => {
    let live = true;
    getSignInOptions()
      .then((options) => {
        if (live) setDirect(options);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function onSocial(provider: "google" | "apple") {
    setError("");
    setBusy(true);
    try {
      const result = await authClient.signIn.social({ provider, callbackURL: "/" });
      if (result?.error) setError(result.error.message || "Could not start that sign-in.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start that sign-in.");
    } finally {
      setBusy(false);
    }
  }

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result =
        mode === "up"
          ? await authClient.signUp.email({
              name: name.trim(),
              email: email.trim(),
              password,
              callbackURL: "/",
            })
          : await authClient.signIn.email({
              email: email.trim(),
              password,
              callbackURL: "/",
            });
      if (result.error) {
        setError(result.error.message || "Could not sign in with that email.");
        return;
      }
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in with that email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Google / X sign-in runs through Grok's sign-in broker, so it only works while the app is hosted by Grok.
          Set VITE_SOCIAL_SIGNIN=true when hosting on Grok to show them. */}
      {SOCIAL_SIGNIN && GROK_PROVIDERS.map((p) => (
        <button
          key={p.providerId}
          type="button"
          className={p.providerId === "grok-google" ? "btn btn-rust w-full" : "btn btn-ghost w-full"}
          onClick={() => signIn(p.providerId, { callbackURL: "/" })}
        >
          Continue with {p.label}
        </button>
      ))}
      {direct.google ? (
        <button type="button" className="btn btn-rust w-full" disabled={busy} onClick={() => void onSocial("google")}>
          Continue with Google
        </button>
      ) : null}
      {direct.apple ? (
        <button type="button" className="btn btn-ghost w-full" disabled={busy} onClick={() => void onSocial("apple")}>
          Continue with Apple
        </button>
      ) : null}
      {SOCIAL_SIGNIN || direct.google || direct.apple ? (
        <p className="py-1 text-center text-xs text-muted">
          or use email
        </p>
      ) : null}
      <form className="flex flex-col gap-2" onSubmit={onEmail}>
        {mode === "up" ? (
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            required
          />
        ) : null}
        <input
          className="field"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="email"
          required
        />
        <input
          className="field"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (8+ characters)"
          autoComplete={mode === "up" ? "new-password" : "current-password"}
          minLength={8}
          required
        />
        {error ? (
          <p role="alert" className="text-sm text-rust">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-pine w-full" disabled={busy}>
          {busy ? "Please wait…" : mode === "up" ? "Create account" : "Sign in with email"}
        </button>
      </form>
      <button
        type="button"
        className="text-sm font-medium text-brand"
        onClick={() => {
          setMode(mode === "up" ? "in" : "up");
          setError("");
        }}
      >
        {mode === "up" ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>
    </div>
  );
}
