"use client";

import { FormEvent, useEffect, useState } from "react";
import { safeNext } from "@/lib/origin";
import { dropSession, keepSession, keptSession } from "./keepSession";
import { Mark } from "./Mark";
import { PasswordField } from "./PasswordField";

const SAMPLE = `<?php
class Animal {
    public string $nom;
    public function __construct(string $nom) {
        $this->nom = $nom;
    }
}`;

export function AuthScreen() {
  const [mode, setMode] = useState<"register" | "login" | "forgot">("login");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [inviteCode, setInviteCode] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "register") setMode("register");
    const next = params.get("next") || "";
    const match = next.match(/^\/([A-Za-z]{5})$/);
    if (match) setInviteCode(match[1].toUpperCase());
    const enter = () => {
      location.href = safeNext(params.get("next"));
    };
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (res) => {
        if (res.ok) {
          enter();
          return;
        }
        const token = keptSession();
        if (!token) {
          setReady(true);
          return;
        }
        const resumed = await fetch("/api/auth/resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          cache: "no-store",
        });
        if (resumed.ok) enter();
        else {
          dropSession();
          setReady(true);
        }
      })
      .catch(() => setReady(true));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSent("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      name: String(form.get("name") ?? ""),
    };
    const endpoint =
      mode === "login" ? "/api/auth/login" : mode === "forgot" ? "/api/auth/forgot" : "/api/auth/register";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Connexion impossible.");
        setBusy(false);
        return;
      }
      if (mode === "forgot") {
        setSent(data.message || "Un email vient de partir pour choisir un nouveau mot de passe.");
        setBusy(false);
        return;
      }
      if (typeof data.token === "string") keepSession(data.token);
      const next = new URLSearchParams(window.location.search).get("next");
      location.href = safeNext(next);
    } catch {
      setError("Le site ne répond pas.");
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="page">
        <p className="boot wrap">CodeCapture</p>
      </main>
    );
  }

  return (
    <main className="landing-cyber">
      <div className="invite-fx" aria-hidden="true">
        <div className="invite-grid" />
        <div className="invite-scan" />
        <div className="invite-glow" />
        <p className="invite-watermark landing-mark">CC</p>
      </div>
      <p className="landing-brand invite-brand">
        <Mark />
        CodeCapture
      </p>
      <div className="landing">
        <section className="landing-copy">
          <p className="kicker">Un compte · deux écrans</p>
          <h1>
            Photographie
            <br />
            le code.
          </h1>
          <p className="lede">Téléphone qui capture. PC qui récupère les fichiers.</p>
          <ul className="landing-signals">
            <li>
              <span>01</span>
              Capture auto
            </li>
            <li>
              <span>02</span>
              Groupe partagé
            </li>
            <li>
              <span>03</span>
              Fichiers prêts
            </li>
          </ul>
          <div className="fake shard" aria-hidden="true">
            <i className="tick tl" />
            <i className="tick tr" />
            <i className="tick bl" />
            <i className="tick br" />
            <div className="tabs">
              <span className="tab on">animal.php</span>
              <span className="tab">chat.php</span>
            </div>
            <pre>{SAMPLE}</pre>
          </div>
        </section>
        <section className="auth-card shard">
          <i className="tick tl" />
          <i className="tick tr" />
          <i className="tick bl" />
          <i className="tick br" />
          <p className="kicker">
            {mode === "login" ? "Accès" : mode === "forgot" ? "Reset" : "Nouveau signal"}
          </p>
          <h2>{mode === "login" ? "Connexion" : mode === "forgot" ? "Mot de passe oublié" : "Créer le compte"}</h2>
          <p className="muted">
            {mode === "forgot"
              ? "Email + prénom du compte. On t’envoie le lien."
              : inviteCode
                ? `Ensuite tu rejoins ${inviteCode}.`
                : "Même compte sur téléphone et PC."}
          </p>
          {sent ? (
            <p className="hint">{sent}</p>
          ) : (
            <form className="form" onSubmit={onSubmit}>
              {mode !== "login" ? (
                <label className="field">
                  <span>Prénom</span>
                  <input name="name" autoComplete="name" required maxLength={40} />
                </label>
              ) : null}
              <label className="field">
                <span>Email</span>
                <input name="email" type="email" autoComplete="email" autoCapitalize="none" required />
              </label>
              {mode === "forgot" ? null : (
                <PasswordField
                  label="Mot de passe"
                  name="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              )}
              {error ? <p className="form-error">{error}</p> : null}
              <button className="lime" type="submit" disabled={busy}>
                {busy
                  ? "Patiente…"
                  : mode === "login"
                    ? "Se connecter"
                    : mode === "forgot"
                      ? "Envoyer l’email"
                      : "Créer le compte"}
              </button>
            </form>
          )}
          <p className="auth-links">
            {mode === "login" ? (
              <button
                type="button"
                className="switch-link"
                onClick={() => {
                  setMode("forgot");
                  setError("");
                  setSent("");
                }}
              >
                Mot de passe oublié
              </button>
            ) : null}
            <button
              type="button"
              className="switch-link"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
                setSent("");
              }}
            >
              {mode === "login" ? "Créer un compte" : "J’ai déjà un compte"}
            </button>
          </p>
        </section>
      </div>
    </main>
  );
}
