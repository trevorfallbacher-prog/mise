import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState("");

  const send = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setPhase("sending");
    setErrorMsg("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setErrorMsg(error.message);
      setPhase("error");
    } else {
      setPhase("sent");
    }
  };

  const signInWithGoogle = async () => {
    setErrorMsg("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        // Force Google to show the account picker every time instead
        // of silently re-auth'ing the most recent account. Critical
        // for users who run multiple Google identities (testing
        // family-share flows with two accounts on the same device,
        // sign-out → swap-account, etc.). Without `prompt`, Google
        // SSO returns the cached session and the app loops back into
        // the same identity.
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setErrorMsg(error.message);
      setPhase("error");
    }
    // On success the browser will redirect away to Google — no further UI.
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "100vh", padding: 32, textAlign: "center",
    }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>👨‍🍳</div>
      <h1 style={{
        fontFamily: "'Fraunces',serif", fontSize: 44, fontWeight: 300,
        fontStyle: "italic", color: "#f5c842", letterSpacing: "-0.03em",
        marginBottom: 10,
      }}>mise</h1>
      <p style={{
        fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: "#888",
        maxWidth: 280, lineHeight: 1.5, marginBottom: 36,
      }}>
        {phase === "sent"
          ? "Check your email. Tap the link we just sent."
          : "Sign in with your email. We'll send you a magic link — no passwords."}
      </p>

      {phase !== "sent" && (
        <div style={{ width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: 14 }}>
          <button
            type="button"
            onClick={signInWithGoogle}
            style={{
              padding: "14px", borderRadius: 12,
              border: "1px solid #2a2a2a", background: "#f0ece4",
              color: "#111", fontFamily: "'DM Sans',sans-serif",
              fontSize: 14, fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              transition: "all 0.2s",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 7.1 29.3 5 24 5 16.2 5 9.4 9.3 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.3-7.2 2.3-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.2 39.6 16 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.2 5.2C41.8 35.4 44 30 44 24c0-1.2-.1-2.3-.4-3.5z"/>
            </svg>
            Continue with Google
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, height: 1, background: "#222" }} />
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.15em" }}>OR</span>
            <div style={{ flex: 1, height: 1, background: "#222" }} />
          </div>
        </div>
      )}

      {phase !== "sent" && (
        <form onSubmit={send} style={{ width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
            disabled={phase === "sending"}
            style={{
              padding: "14px 16px", borderRadius: 12,
              border: "1px solid #2a2a2a", background: "#161616",
              color: "#f0ece4", fontFamily: "'DM Sans',sans-serif", fontSize: 15,
              outline: "none", textAlign: "center",
            }}
          />
          <button
            type="submit"
            disabled={!email.trim() || phase === "sending"}
            style={{
              padding: "14px", borderRadius: 12, border: "none",
              background: email.trim() ? "#f5c842" : "#1a1a1a",
              color: email.trim() ? "#111" : "#444",
              fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 600,
              letterSpacing: "0.08em",
              cursor: email.trim() && phase !== "sending" ? "pointer" : "not-allowed",
              transition: "all 0.2s",
            }}
          >
            {phase === "sending" ? "SENDING…" : "SEND MAGIC LINK →"}
          </button>
          {phase === "error" && (
            <div style={{
              padding: "10px 12px", background: "#1a0f0f",
              border: "1px solid #3a1a1a", borderRadius: 10,
              fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f87171",
            }}>
              {errorMsg || "Something went wrong. Try again."}
            </div>
          )}
        </form>
      )}

      {phase === "sent" && (
        <button
          onClick={() => { setPhase("idle"); setEmail(""); }}
          style={{
            marginTop: 24, background: "none", border: "none",
            color: "#666", fontFamily: "'DM Mono',monospace", fontSize: 12,
            letterSpacing: "0.08em", cursor: "pointer",
          }}
        >
          USE A DIFFERENT EMAIL
        </button>
      )}
    </div>
  );
}
