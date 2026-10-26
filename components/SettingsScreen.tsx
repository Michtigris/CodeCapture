"use client";

import { FormEvent, useEffect, useState } from "react";
import { MODELS } from "@/lib/constants";
import type { GroupSummary, PublicUser } from "@/lib/types";
import { copyText } from "./copy";
import { QrMark } from "./QrMark";
import { TopBar } from "./TopBar";

export function SettingsScreen() {
  const [me, setMe] = useState<PublicUser | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [siteUrl, setSiteUrl] = useState("");
  const [copied, setCopied] = useState("");
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    setSiteUrl(window.location.origin);
    fetch("/api/settings", { cache: "no-store" }).then(async (res) => {
      if (res.status === 401) {
        await fetch("/api/auth/logout", { method: "POST" });
        location.href = "/";
        return;
      }
      const data = await res.json();
      setMe(data.user);
      setHint(data.keyHint);
      setName(data.user.name);
      setModel(data.user.model);
    });
    fetch("/api/groups", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.groups) setGroups(data.groups);
      });
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved("");
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        model,
        openaiKey: key,
        clearKey,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Enregistrement impossible.");
      return;
    }
    setMe(data.user);
    setHint(data.keyHint);
    setKey("");
    setClearKey(false);
    setSaved("Réglages enregistrés.");
  }

  async function removeGroup(id: string) {
    const res = await fetch(`/api/groups/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Suppression impossible.");
      return;
    }
    setGroups((current) => current?.filter((group) => group.id !== id) ?? null);
    setConfirmId(null);
  }

  if (!me) {
    return (
      <main className="page">
        <p className="boot wrap">Chargement…</p>
      </main>
    );
  }

  return (
    <main className="page">
      <TopBar email={me.email} />
      <div className="wrap" style={{ maxWidth: 720 }}>
        <p className="kicker">Compte</p>
        <h1 className="display" style={{ fontSize: "clamp(36px, 5vw, 56px)", letterSpacing: "-0.045em", marginTop: 8 }}>
          Réglages
        </h1>
        <p className="lede">
          La clé API OpenAI reste sur ce serveur. Elle sert uniquement à envoyer tes photos à ChatGPT pour en extraire
          les fichiers. Tu peux en créer une sur platform.openai.com/api-keys. Tu peux aussi mettre OPENAI_API_KEY dans
          un fichier .env.local.
        </p>
        <section className="link-card share-card">
          <QrMark path="/" label="QR code vers CodeCapture" />
          <div className="share-copy">
            <h2>Ouvrir sur un autre écran</h2>
            <p className="muted">Scanne le QR code, copie le lien, ou envoie-le par email.</p>
            {siteUrl ? <p className="link-url">{siteUrl}</p> : null}
            <div className="row">
              <button
                type="button"
                className="ghost"
                disabled={!siteUrl}
                onClick={() => {
                  void copyText(siteUrl).then(() => setCopied("Lien copié."));
                }}
              >
                Copier le lien
              </button>
              <a
                className="ghost"
                href={
                  siteUrl
                    ? `mailto:?subject=${encodeURIComponent("CodeCapture")}&body=${encodeURIComponent(`Ouvre CodeCapture :\n${siteUrl}`)}`
                    : undefined
                }
              >
                Envoyer par email
              </a>
            </div>
            {copied ? <p className="hint">{copied}</p> : null}
          </div>
        </section>
        <form className="form" onSubmit={onSubmit}>
          <label className="field">
            <span>Prénom</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required />
          </label>
          <label className="field">
            <span>Modèle</span>
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              {MODELS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Clé API OpenAI {hint ? `(enregistrée ${hint})` : "(aucune clé enregistrée)"}</span>
            <input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-…"
            />
          </label>
          {hint ? (
            <label className="check">
              <input type="checkbox" checked={clearKey} onChange={(event) => setClearKey(event.target.checked)} />
              Supprimer la clé enregistrée
            </label>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
          {saved ? <p className="hint">{saved}</p> : null}
          <button className="lime" type="submit" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </form>
        <section className="own-groups">
          <h2>Tes groupes</h2>
          <p className="hint">Seul le compte qui a créé un groupe peut le supprimer.</p>
          {groups === null ? null : groups.length === 0 ? (
            <p className="empty">Aucun groupe.</p>
          ) : (
            groups.map((group) => (
              <article key={group.id} className="own-group">
                <strong>
                  {group.name} {group.code ? <span className="group-code">{group.code}</span> : null}
                </strong>
                {group.owner ? (
                  confirmId === group.id ? (
                    <div className="own-confirm">
                      <p>Supprimer « {group.name} », ses photos et ses fichiers ? C’est définitif.</p>
                      <div className="row">
                        <button type="button" className="danger" onClick={() => void removeGroup(group.id)}>
                          Supprimer définitivement
                        </button>
                        <button type="button" className="ghost" onClick={() => setConfirmId(null)}>
                          Annuler
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="danger" onClick={() => setConfirmId(group.id)}>
                      Supprimer
                    </button>
                  )
                ) : (
                  <span className="hint">Membre</span>
                )}
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
