"use client";

import { FormEvent, useEffect, useState } from "react";
import type { GroupSummary, PublicUser } from "@/lib/types";
import { copyText } from "./copy";
import { QrMark } from "./QrMark";
import { TopBar } from "./TopBar";

export function SettingsScreen() {
  const [me, setMe] = useState<PublicUser | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
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
      setName(data.user.name);
      setEmail(data.user.email);
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
        email,
        currentPassword,
        password,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Enregistrement impossible.");
      return;
    }
    setMe(data.user);
    setName(data.user.name);
    setEmail(data.user.email);
    setCurrentPassword("");
    setPassword("");
    setSaved("RÃ©glages enregistrÃ©s.");
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
        <p className="boot wrap">Chargementâ€¦</p>
      </main>
    );
  }

  return (
    <main className="page">
      <TopBar name={me.name} />
      <div className="wrap" style={{ maxWidth: 720 }}>
        <p className="kicker">Compte</p>
        <h1 className="display" style={{ fontSize: "clamp(36px, 5vw, 56px)", letterSpacing: "-0.045em", marginTop: 8 }}>
          RÃ©glages
        </h1>
        <section className="link-card share-card">
          <QrMark path="/" label="QR code vers CodeCapture" />
          <div className="share-copy">
            <h2>Ouvrir sur un autre Ã©cran</h2>
            <p className="muted">Scanne le QR code, copie le lien, ou envoie-le par email.</p>
            {siteUrl ? <p className="link-url">{siteUrl}</p> : null}
            <div className="row">
              <button
                type="button"
                className="ghost"
                disabled={!siteUrl}
                onClick={() => {
                  void copyText(siteUrl).then(() => setCopied("Lien copiÃ©."));
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
            <span>PrÃ©nom</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required />
          </label>
          <label className="field">
            <span>Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
          </label>
          <SecretField
            label="Mot de passe actuel"
            value={currentPassword}
            autoComplete="current-password"
            onChange={setCurrentPassword}
          />
          <SecretField
            label="Nouveau mot de passe"
            value={password}
            autoComplete="new-password"
            onChange={setPassword}
          />
          <p className="hint">
            Laisse le nouveau mot de passe vide pour garder lâ€™actuel. Le mot de passe dÃ©jÃ  enregistrÃ© ne sâ€™affiche pas :
            il nâ€™est pas gardÃ© en clair. Afficher montre seulement ce que tu es en train de saisir.
          </p>
          {error ? <p className="form-error">{error}</p> : null}
          {saved ? <p className="hint">{saved}</p> : null}
          <button className="lime" type="submit" disabled={busy}>
            {busy ? "Enregistrementâ€¦" : "Enregistrer"}
          </button>
        </form>
        <section className="own-groups">
          <h2>Tes groupes</h2>
          <p className="hint">Seul le compte qui a crÃ©Ã© un groupe peut le supprimer.</p>
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
                      <p>Supprimer Â« {group.name} Â», ses photos et ses fichiers ? Câ€™est dÃ©finitif.</p>
                      <div className="row">
                        <button type="button" className="danger" onClick={() => void removeGroup(group.id)}>
                          Supprimer dÃ©finitivement
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

function SecretField({
  label,
  value,
  autoComplete,
  onChange,
}: {
  label: string;
  value: string;
  autoComplete: string;
  onChange: (value: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="secret">
        <input
          value={value}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="button" onClick={() => setShown((open) => !open)}>
          {shown ? "Masquer" : "Afficher"}
        </button>
      </div>
    </label>
  );
}
