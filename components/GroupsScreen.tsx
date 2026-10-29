"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { GroupSummary, PublicUser } from "@/lib/types";
import { formatWhen } from "./format";
import { TopBar } from "./TopBar";

const TICKER =
  "CodeCapture photographie un écran, une feuille ou un tableau avec le téléphone ou la caméra du PC, puis reconstitue les fichiers sur l’ordinateur.";

function Ticker() {
  return (
    <footer className="ticker" aria-label={TICKER}>
      <div className="ticker-track" aria-hidden="true">
        <span>{TICKER}</span>
        <span>{TICKER}</span>
      </div>
    </footer>
  );
}

function KickClock({ until, onDone }: { until: number; onDone: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((until - Date.now()) / 1000)));
  useEffect(() => {
    const tick = () => {
      const next = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(next);
      if (next <= 0) onDone();
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [until, onDone]);
  return <span className="shard-lock-count">{left}</span>;
}

export function GroupsScreen() {
  const router = useRouter();
  const [me, setMe] = useState<PublicUser | null>(null);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [, setClock] = useState(0);

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
      const groupsRes = await fetch("/api/groups", { cache: "no-store" });
      if (stop) return;
      setMe(meData.user);
      if (groupsRes.ok) setGroups((await groupsRes.json()).groups);
    })().catch(() => {
      if (!stop) setError("Chargement impossible.");
    });
    return () => {
      stop = true;
    };
  }, []);

  async function refreshGroups() {
    const groupsRes = await fetch("/api/groups", { cache: "no-store" });
    if (groupsRes.ok) setGroups((await groupsRes.json()).groups);
  }

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (!next) return;
    if (me && next.toLowerCase() === me.email.toLowerCase()) {
      setError("Le nom du groupe n'est pas l'email du compte.");
      return;
    }
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
      await refreshGroups();
      return;
    }
    router.push(`/${data.group.code}`);
  }

  function openGroup(group: GroupSummary) {
    if (group.access === "banned") return;
    if (group.access === "kicked" && group.kickUntil > Date.now()) return;
    router.push(group.code ? `/${group.code}` : `/groupe/${group.id}`);
  }

  if (!me || !groups) {
    return (
      <main className="page">
        <p className="boot wrap">{error || "Chargement…"}</p>
        <Ticker />
      </main>
    );
  }

  const ordered = groups.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const archived = ordered.length > 5 ? ordered.filter((group) => Date.parse(group.createdAt) < weekAgo) : [];
  const active = ordered.filter((group) => !archived.includes(group));

  function GroupCard({ group }: { group: GroupSummary }) {
    const kicked = group.access === "kicked" && group.kickUntil > Date.now();
    const banned = group.access === "banned";
    return (
      <article className={["shard", banned ? "shard-banned" : "", kicked ? "shard-kicked" : ""].filter(Boolean).join(" ")}>
        <i className="tick tl" />
        <i className="tick tr" />
        <i className="tick bl" />
        <i className="tick br" />
        <div className="shard-top">
          <h2>{group.name}</h2>
          <span className="shard-code">{group.code}</span>
        </div>
        <dl className="shard-stats">
          <div>
            <dt>Créateur</dt>
            <dd>{group.creatorName}</dd>
          </div>
          <div>
            <dt>Membres</dt>
            <dd>
              {group.memberOnline}/{group.memberCount}
            </dd>
          </div>
          <div>
            <dt>Fichiers</dt>
            <dd>{group.fileCount}</dd>
          </div>
          <div>
            <dt>Créé</dt>
            <dd>{formatWhen(group.createdAt)}</dd>
          </div>
        </dl>
        <button type="button" className="cp" disabled={banned || kicked} onClick={() => openGroup(group)}>
          Ouvrir
        </button>
        {banned ? (
          <div className="shard-lock banned" aria-hidden="true">
            <span>BANNI !</span>
          </div>
        ) : null}
        {kicked ? (
          <div className="shard-lock kicked" aria-hidden="true">
            <KickClock
              until={group.kickUntil}
              onDone={() => {
                setClock((n) => n + 1);
                void refreshGroups();
              }}
            />
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <main className="page">
      <TopBar name={me.name} />
      <div className="wrap">
        {error ? <p className="form-error">{error}</p> : null}
        {ordered.length === 0 ? (
          <section className="join-gate">
            <p className="kicker">Aucun groupe</p>
            <h1>Créer ou rejoindre</h1>
            <form className="creator" autoComplete="off" onSubmit={createGroup}>
              <input className="autofill-trap" tabIndex={-1} autoComplete="username" aria-hidden="true" defaultValue="" />
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                name="group-label"
                placeholder="Nom du groupe"
                maxLength={60}
                aria-label="Nom du groupe"
                autoComplete="off"
                autoCorrect="off"
              />
              <button className="cp" type="submit" disabled={busy || !name.trim()}>
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
              <button className="cp-line" type="submit" disabled={joining || code.length !== 5}>
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
                <form className="creator" autoComplete="off" onSubmit={createGroup}>
                  <input className="autofill-trap" tabIndex={-1} autoComplete="username" aria-hidden="true" defaultValue="" />
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    name="group-label"
                    placeholder="Nom du groupe"
                    maxLength={60}
                    aria-label="Nom du groupe"
                    autoComplete="off"
                    autoCorrect="off"
                  />
                  <button className="cp" type="submit" disabled={busy || !name.trim()}>
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
                  <button className="cp-line" type="submit" disabled={joining || code.length !== 5}>
                    {joining ? "…" : "Rejoindre"}
                  </button>
                </form>
              </div>
            </div>
            <div className="shards">
              {active.map((group) => (
                <GroupCard key={group.id} group={group} />
              ))}
            </div>
            {archived.length ? (
              <details className="archived">
                <summary>Groupes plus anciens · {archived.length}</summary>
                <div className="shards">
                  {archived.map((group) => (
                    <GroupCard key={group.id} group={group} />
                  ))}
                </div>
              </details>
            ) : null}
            {!active.length && !archived.length ? (
              <p className="empty">Tes groupes sont archivés. Tu peux toujours en créer ou en rejoindre un.</p>
            ) : null}
          </>
        )}
      </div>
      <Ticker />
    </main>
  );
}
