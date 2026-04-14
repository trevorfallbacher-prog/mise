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
        <form onSubmit={send} style={{ width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: 12 }}>
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
