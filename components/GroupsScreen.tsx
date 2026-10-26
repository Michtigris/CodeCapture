"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { GroupSummary, PublicUser } from "@/lib/types";
import { formatWhen } from "./format";
import { Toast, useToast } from "./toast";
import { TopBar } from "./TopBar";
import { copyText } from "./copy";

type Network = { origin: string; lan: string[]; hosted?: boolean };

export function GroupsScreen() {
  const router = useRouter();
  const { msg, toast } = useToast();
  const [me, setMe] = useState<PublicUser | null>(null);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [network, setNetwork] = useState<Network | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    (async () => {
      const meRes = await fetch("/api/auth/me", { cache: "no-store" });
      if (meRes.status === 401) {
        await fetch("/api/auth/logout", { method: "POST" });
        location.href = "/";
        return;
      }
      const meData = await meRes.json();
      const [groupsRes, netRes] = await Promise.all([
        fetch("/api/groups", { cache: "no-store" }),
        fetch("/api/network", { cache: "no-store" }),
      ]);
      if (stop) return;
      setMe(meData.user);
      if (groupsRes.ok) setGroups((await groupsRes.json()).groups);
      if (netRes.ok) setNetwork(await netRes.json());
    })().catch(() => {
      if (!stop) setError("Chargement impossible.");
    });
    return () => {
      stop = true;
    };
  }, []);

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (!next) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Création impossible.");
      return;
    }
    router.push(`/${data.group.code}`);
  }

  async function joinByCode(event: FormEvent) {
    event.preventDefault();
    const wanted = code.trim().toUpperCase();
    if (!/^[A-Z]{5}$/.test(wanted)) {
      setError("Le code fait 5 lettres.");
      return;
    }
    setJoining(true);
    setError("");
    const res = await fetch("/api/groups/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: wanted }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Ce code ne correspond à aucun groupe.");
      setJoining(false);
      return;
    }
    router.push(`/${data.group.code}`);
  }

  function openGroup(group: GroupSummary) {
    router.push(group.code ? `/${group.code}` : `/groupe/${group.id}`);
  }

  const links = network ? [network.origin, ...network.lan.filter((url) => url !== network.origin)] : [];

  if (!me || !groups) {
    return (
      <main className="page">
        <p className="boot wrap">{error || "Chargement…"}</p>
      </main>
    );
  }

  const ordered = groups.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const archived = ordered.length > 5 ? ordered.filter((group) => Date.parse(group.createdAt) < weekAgo) : [];
  const active = ordered.filter((group) => !archived.includes(group));

  function GroupCard({ group }: { group: GroupSummary }) {
    return (
      <article className="card" key={group.id}>
        <div>
          <h2>
            {group.name} <span className="group-code">{group.code}</span>
          </h2>
          <div className="card-meta">
            <span>
              {group.pendingCount} en attente · {group.photoCount} photo{group.photoCount > 1 ? "s" : ""}
            </span>
            <span>
              {group.fileCount > 0
                ? `${group.fileCount} fichier${group.fileCount > 1 ? "s" : ""} extrait${group.fileCount > 1 ? "s" : ""}`
                : "Aucun fichier extrait"}
            </span>
            <span>{formatWhen(group.lastCaptureAt || group.createdAt)}</span>
          </div>
        </div>
        <div className="row">
          <button type="button" className="lime" onClick={() => openGroup(group)}>
            Ouvrir
          </button>
        </div>
      </article>
    );
  }

  return (
    <main className="page">
      <TopBar email={me.email} />
      <div className="wrap">
        {error ? <p className="form-error">{error}</p> : null}
        {ordered.length === 0 ? (
          <section className="join-gate">
            <p className="kicker">Aucun groupe</p>
            <h1>Créer ou rejoindre</h1>
            <form className="creator" onSubmit={createGroup}>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nom du groupe"
                maxLength={60}
                aria-label="Nom du groupe"
              />
              <button className="lime" type="submit" disabled={busy || !name.trim()}>
                {busy ? "Création…" : "Créer"}
              </button>
            </form>
            <form className="creator" onSubmit={joinByCode}>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5))}
                placeholder="Code, 5 lettres"
                maxLength={5}
                aria-label="Code du groupe"
                autoCapitalize="characters"
              />
              <button className="ghost" type="submit" disabled={joining || code.length !== 5}>
                {joining ? "…" : "Rejoindre"}
              </button>
            </form>
          </section>
        ) : (
          <>
            <div className="group-head">
              <div>
                <p className="kicker">Bonjour {me.name}</p>
                <h1>Tes groupes</h1>
              </div>
              <div className="join-actions">
                <form className="creator" onSubmit={createGroup}>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Nom du groupe"
                    maxLength={60}
                    aria-label="Nom du groupe"
                  />
                  <button className="lime" type="submit" disabled={busy || !name.trim()}>
                    {busy ? "…" : "Créer"}
                  </button>
                </form>
                <form className="creator" onSubmit={joinByCode}>
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5))}
                    placeholder="ABCDE"
                    maxLength={5}
                    aria-label="Code du groupe"
                    autoCapitalize="characters"
                  />
                  <button className="ghost" type="submit" disabled={joining || code.length !== 5}>
                    {joining ? "…" : "Rejoindre"}
                  </button>
                </form>
              </div>
            </div>
            {active.length === 0 ? (
              <p className="empty">Tes groupes sont archivés. Tu peux toujours en créer ou en rejoindre un.</p>
            ) : (
              <div className="group-grid">{active.map((group) => <GroupCard key={group.id} group={group} />)}</div>
            )}
            {archived.length ? (
              <details className="archived">
                <summary>Archivés · {archived.length}</summary>
                <p className="muted">Plus de 5 groupes : ceux de plus d’une semaine sont ici.</p>
                <div className="group-grid">
                  {archived.map((group) => (
                    <GroupCard key={group.id} group={group} />
                  ))}
                </div>
              </details>
            ) : null}
          </>
        )}
        <section className="link-card">
          <p className="kicker">Relier le téléphone</p>
          <p className="muted">
            {network?.hosted
              ? `Ouvre cette adresse sur le téléphone et connecte-toi avec ${me.email}. Le site est en https, la caméra automatique peut démarrer.`
              : `Ouvre CodeCapture sur le téléphone et connecte-toi avec ${me.email}. Si le site tourne sur cet ordinateur, utilise l’adresse IP du réseau, pas localhost. Autorise Node dans le pare-feu Windows si la page ne s’ouvre pas.`}
          </p>
          <div className="link-list">
            {links.map((url) => (
              <div className="link-row" key={url}>
                <code>{url}</code>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    void copyText(url).then(() => toast("Lien copié"));
                  }}
                >
                  Copier
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
      <Toast msg={msg} />
    </main>
  );
}
