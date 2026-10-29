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
    <main className="gate">
      <p className="landing-brand">
        <Mark />
        CodeCapture
      </p>
      <div className="landing">
      <section className="landing-copy">
        <p className="kicker">Un compte. Deux écrans.</p>
        <h1>
          Photographie
          <br />
          le code.
        </h1>
        <p className="lede">
          Tu ouvres un groupe. Le téléphone passe en mode caméra et prend une photo devant lui, à l’intervalle que tu
          choisis. Les photos s’accumulent. Quand tu envoies la série à ChatGPT, l’agent reconstitue chaque fichier,
          prêt à copier.
        </p>
        <ol className="steps">
          <li>
            <span className="num">1</span>
            <p>
              <strong>Même compte</strong>
              Téléphone et ordinateur se connectent avec le même email.
            </p>
          </li>
          <li>
            <span className="num">2</span>
            <p>
              <strong>Un groupe</strong>
              C’est la session de travail. Les deux écrans voient les mêmes photos.
            </p>
          </li>
          <li>
            <span className="num">3</span>
            <p>
              <strong>La série</strong>
              Le téléphone photographie tout seul, toutes les x minutes.
            </p>
          </li>
          <li>
            <span className="num">4</span>
            <p>
              <strong>ChatGPT</strong>
              Un clic envoie les dernières photos. L’agent connaît déjà la consigne : sortir les fichiers.
            </p>
          </li>
          <li>
            <span className="num">5</span>
            <p>
              <strong>Les onglets</strong>
              animal.php, chat.php, ou un dossier. Clic droit sur le code pour tout copier.
            </p>
          </li>
        </ol>
        <div className="fake" aria-hidden="true">
          <div className="tabs">
            <span className="tab on">animal.php</span>
            <span className="tab">chat.php</span>
          </div>
          <pre>{SAMPLE}</pre>
          <p className="hint">Clic droit pour tout copier</p>
        </div>
      </section>
      <section className="auth-card">
        <h2>{mode === "login" ? "Connexion" : mode === "forgot" ? "Mot de passe oublié" : "Créer le compte"}</h2>
        <p className="muted">
          {mode === "forgot"
            ? "Entre l’email et le prénom du compte, écrits comme à l’inscription. Un email t’envoie le lien pour en choisir un nouveau."
            : inviteCode
              ? `Après ça, tu rejoins le groupe ${inviteCode} et tu y arrives directement.`
              : "Le même compte relie le téléphone et l’ordinateur."}
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
              {busy ? "Patiente…" : mode === "login" ? "Se connecter" : mode === "forgot" ? "Envoyer l’email" : "Créer le compte"}
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
