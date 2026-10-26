"use client";

import { FormEvent, useState } from "react";
import { PasswordField } from "@/components/PasswordField";
import { Mark } from "@/components/Mark";

export default function ResetPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Les deux mots de passe ne sont pas identiques.");
      return;
    }
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    setBusy(true);
    const res = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Le mot de passe n'a pas pu être changé.");
      return;
    }
    location.href = "/groupes";
  }

  return (
    <main className="solo">
      <section className="auth-card">
        <p className="kicker">
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <Mark /> Nouveau mot de passe
          </span>
        </p>
        <h2>Choisis-en un autre.</h2>
        <p className="muted">Le lien reçu par email ne sert qu’une fois, pendant une heure.</p>
        <form className="form" onSubmit={onSubmit}>
          <PasswordField
            label="Nouveau mot de passe"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
          />
          <PasswordField
            label="Confirme le mot de passe"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
          />
          {error ? <p className="form-error">{error}</p> : null}
          <button className="lime" type="submit" disabled={busy}>
            {busy ? "Enregistrement…" : "Changer le mot de passe"}
          </button>
        </form>
      </section>
    </main>
  );
}
