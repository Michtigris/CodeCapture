"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_PHOTOS_PER_SEND } from "@/lib/constants";
import { INSERT_DAY_MS, parseInsert } from "@/lib/insert";
import type { GroupPayload, PublicUser } from "@/lib/types";
import { CameraPane } from "./CameraPane";
import { copyPhotoSet } from "./copy";
import { deviceId } from "./device";
import { FileStage } from "./FileStage";
import { QrMark } from "./QrMark";
import { formatWhen } from "./format";
import { Toast, useToast } from "./toast";
import { TopBar } from "./TopBar";

function pasteKey(groupId: string) {
  return `cc_paste_${groupId}`;
}

function loadPastes(groupId: string): { hash: string; at: number }[] {
  try {
    const raw = localStorage.getItem(pasteKey(groupId));
    const list = raw ? (JSON.parse(raw) as { hash?: unknown; at?: unknown }[]) : [];
    const now = Date.now();
    if (!Array.isArray(list)) return [];
    return list.filter(
      (item): item is { hash: string; at: number } =>
        !!item && typeof item.hash === "string" && typeof item.at === "number" && now - item.at < INSERT_DAY_MS,
    );
  } catch {
    return [];
  }
}

async function hashPaste(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function Workspace({ groupId }: { groupId: string }) {
  const { msg, toast } = useToast();
  const [data, setData] = useState<GroupPayload | null>(null);
  const [me, setMe] = useState<PublicUser | null>(null);
  const [missing, setMissing] = useState(false);
  const [panel, setPanel] = useState<"camera" | "photos" | "fichiers">("camera");
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [briefDirty, setBriefDirty] = useState(false);
  const [includeSent, setIncludeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [followLatest, setFollowLatest] = useState(true);
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [openPhoto, setOpenPhoto] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [packetOpen, setPacketOpen] = useState(false);
  const [packetIds, setPacketIds] = useState<string[]>([]);
  const [reply, setReply] = useState("");
  const [packing, setPacking] = useState(false);
  const [wide, setWide] = useState(false);
  const [handheld, setHandheld] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [selfId, setSelfId] = useState("");
  const nameDirty = useRef(false);
  const sendingRef = useRef(false);
  const [lotIndex, setLotIndex] = useState(0);
  const [insertDot, setInsertDot] = useState<"idle" | "ok" | "bad" | "same">("idle");
  const [focusFile, setFocusFile] = useState<{ name: string; nonce: number } | null>(null);
  const insertLock = useRef(false);
  const dotTimer = useRef(0);
  const seenShots = useRef(0);
  const pendingShots = (data?.photos ?? []).filter((photo) => !photo.captureId).length;
  const qrDismissed = useRef(false);
  const qrAdding = useRef(false);
  const qrBaseline = useRef(0);
  const phoneCount = (data?.cameras ?? []).filter(
    (camera) => camera.deviceId !== selfId && camera.phone !== false,
  ).length;

  function closeQr() {
    qrDismissed.current = true;
    qrAdding.current = false;
    setQrOpen(false);
  }

  function openQr() {
    qrDismissed.current = false;
    qrAdding.current = phoneCount > 0;
    qrBaseline.current = phoneCount;
    setQrOpen(true);
  }

  const reload = useCallback(async () => {
    const res = await fetch(`/api/groups/${groupId}`, { cache: "no-store" });
    if (res.status === 401) {
      await fetch("/api/auth/logout", { method: "POST" });
      location.href = "/";
      return;
    }
    if (res.status === 404) {
      setMissing(true);
      return;
    }
    if (!res.ok) return;
    const payload = (await res.json()) as GroupPayload;
    setData(payload);
    setMissing(false);
  }, [groupId]);

  useEffect(() => {
    let stop = false;
    let timer = 0;
    const tick = async () => {
      try {
        if (!stop && document.visibilityState === "visible") await reload();
      } catch {
        /* le prochain passage réessaiera */
      }
      if (!stop) timer = window.setTimeout(tick, document.hidden ? 12000 : 1000);
    };
    void tick();
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (!stop && payload?.user) setMe(payload.user);
      });
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [reload]);

  useEffect(() => {
    let stop = false;
    let timer = 0;
    const tick = async () => {
      try {
        if (!stop && document.visibilityState === "visible") {
          const res = await fetch(`/api/groups/${groupId}/camera`, { cache: "no-store" });
          if (res.ok) {
            const payload = (await res.json()) as { cameras?: GroupPayload["cameras"] };
            if (!stop && payload.cameras) {
              setData((current) => (current ? { ...current, cameras: payload.cameras ?? [] } : current));
            }
          }
        }
      } catch {
        /* le prochain passage réessaiera */
      }
      if (!stop) timer = window.setTimeout(tick, document.hidden ? 12000 : 5000);
    };
    void tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [groupId]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px), (pointer: coarse) and (max-device-width: 1100px)");
    const mark = () => setHandheld(media.matches);
    mark();
    media.addEventListener("change", mark);
    return () => media.removeEventListener("change", mark);
  }, []);

  useEffect(() => {
    if (!data) return;
    if (!nameDirty.current) setName(data.group.name);
    if (!briefDirty) setBrief(data.group.brief);
    document.title = `${data.group.name} · CodeCapture`;
  }, [data, briefDirty]);

  useEffect(() => {
    if (pendingShots > seenShots.current) setLotIndex(Math.max(0, pendingShots - 1));
    seenShots.current = pendingShots;
  }, [pendingShots]);

  useEffect(() => {
    if (!data || !followLatest) return;
    setCaptureId(data.captures[0]?.id ?? null);
  }, [data, followLatest]);

  useEffect(() => {
    setSelfId(deviceId());
    const media = window.matchMedia("(min-width: 901px)");
    const apply = () => setWide(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!qrOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeQr();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qrOpen]);

  useEffect(() => {
    if (!wide || handheld || !data) return;
    if (qrAdding.current) {
      if (phoneCount > qrBaseline.current) {
        qrAdding.current = false;
        setQrOpen(false);
      }
      return;
    }
    if (phoneCount > 0) {
      setQrOpen(false);
      return;
    }
    if (!qrDismissed.current) setQrOpen(true);
  }, [wide, handheld, data, phoneCount]);

  useEffect(() => {
    if (!openPhoto) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPhoto(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPhoto]);

  async function patchGroup(body: Record<string, unknown>) {
    const res = await fetch(`/api/groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || "Enregistrement impossible.");
  }

  const upload = useCallback(
    async (blob: Blob) => {
      const form = new FormData();
      form.append("photo", blob, "capture.jpg");
      const res = await fetch(`/api/groups/${groupId}/photos`, { method: "POST", body: form });
      const payload = await res.json().catch(() => ({}));
      if (res.status === 401) {
        await fetch("/api/auth/logout", { method: "POST" });
        location.href = "/";
        return;
      }
      if (!res.ok) throw new Error(payload.error || "Envoi de la photo impossible.");
      await reload();
    },
    [groupId, reload],
  );

  async function saveName() {
    if (!data) return;
    const next = name.trim();
    if (!next || next === data.group.name) {
      setName(data.group.name);
      nameDirty.current = false;
      return;
    }
    try {
      await patchGroup({ name: next });
      setData((current) => (current ? { ...current, group: { ...current.group, name: next } } : current));
      nameDirty.current = false;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Nom non enregistré.");
    }
  }

  async function saveBrief() {
    try {
      await patchGroup({ brief });
      setData((current) => (current ? { ...current, group: { ...current.group, brief } } : current));
      setBriefDirty(false);
      toast("Consignes enregistrées");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Consignes non enregistrées.");
    }
  }

  async function changeInterval(seconds: number) {
    setData((current) => (current ? { ...current, group: { ...current.group, intervalSec: seconds } } : current));
    try {
      await patchGroup({ intervalSec: seconds });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Intervalle non enregistré.");
      await reload();
    }
  }

  async function removePhoto(id: string) {
    const res = await fetch(`/api/groups/${groupId}/photos/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast("Suppression impossible.");
      return;
    }
    setConfirmId(null);
    if (openPhoto?.includes(id)) setOpenPhoto(null);
    await reload();
  }

  async function preparePacket() {
    if (!data || packing || targetCount() === 0) return;
    setPacking(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/packet${includeSent ? "?all=1" : ""}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setBanner(payload.error || "PDF impossible.");
        return;
      }
      const ids = (res.headers.get("X-Photo-Ids") || "").split(",").filter(Boolean);
      setPacketIds(ids);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "codecapture.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPacketOpen(true);
    } catch {
      setBanner("Le PDF n'a pas pu être préparé.");
    } finally {
      setPacking(false);
    }
  }

  function targetCount() {
    if (!data) return 0;
    const waiting = data.photos.filter((photo) => !photo.captureId).length;
    return Math.min(includeSent ? data.photos.length : waiting, MAX_PHOTOS_PER_SEND);
  }

  async function importReply() {
    if (!reply.trim() || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply, photoIds: packetIds }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner(payload.error || "Réponse illisible.");
        return;
      }
      const count = payload.capture?.files?.length ?? 0;
      setReply("");
      setPacketOpen(false);
      setFollowLatest(true);
      setPanel("fichiers");
      toast(count > 1 ? `${count} fichiers prêts` : "1 fichier prêt");
      await reload();
    } catch {
      setBanner("Le site ne répond pas.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function send() {
    if (!data || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: includeSent }),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.status === 401) {
        await fetch("/api/auth/logout", { method: "POST" });
        location.href = "/";
        return;
      }
      if (!res.ok) {
        setBanner(payload.error || "Envoi impossible.");
        return;
      }
      const count = payload.capture?.files?.length ?? 0;
      setFollowLatest(true);
      setPanel("fichiers");
      toast(count > 1 ? `${count} fichiers prêts` : "1 fichier prêt");
      await reload();
    } catch {
      setBanner("Le site ne répond pas. Si l’envoi était long, vérifie les fichiers dans une minute.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  if (missing) {
    return (
      <main className="page">
        <TopBar email={me?.email} />
        <div className="wrap">
          <h1>Groupe introuvable</h1>
          <Link href="/groupes">Retour aux groupes</Link>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="page">
        <TopBar email={me?.email} />
        <p className="boot wrap">Chargement du groupe…</p>
      </main>
    );
  }

  const pending = data.photos.filter((photo) => !photo.captureId).length;
  const target = Math.min(includeSent ? data.photos.length : pending, MAX_PHOTOS_PER_SEND);
  const needsKey = me ? !me.hasOpenAIKey : false;
  function flashDot(state: "ok" | "bad" | "same", ms: number) {
    window.clearTimeout(dotTimer.current);
    setInsertDot(state);
    dotTimer.current = window.setTimeout(() => setInsertDot("idle"), ms);
  }

  async function insertClipboard() {
    if (insertLock.current) return;
    insertLock.current = true;
    window.setTimeout(() => {
      insertLock.current = false;
    }, 600);
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      flashDot("bad", 500);
      toast("Le presse-papier est bloqué.");
      return;
    }
    const files = parseInsert(text);
    if (!files) {
      flashDot("bad", 500);
      return;
    }
    const pastes = loadPastes(groupId);
    const hash = await hashPaste(text);
    if (pastes.some((item) => item.hash === hash)) {
      localStorage.setItem(pasteKey(groupId), JSON.stringify(pastes));
      flashDot("same", 1000);
      return;
    }
    const res = await fetch(`/api/groups/${groupId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ block: text }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.filename) {
      flashDot("bad", 500);
      return;
    }
    pastes.push({ hash, at: Date.now() });
    localStorage.setItem(pasteKey(groupId), JSON.stringify(pastes));
    setFollowLatest(false);
    setCaptureId(payload.captureId);
    setFocusFile({ name: payload.filename, nonce: Date.now() });
    if (handheld) setPanel("fichiers");
    flashDot("ok", 1000);
    await reload();
  }

  let label = "Envoyer à ChatGPT";
  if (sending) label = "Lecture des photos…";
  else if (needsKey) label = "Ajouter la clé OpenAI";
  else if (target === 0) label = "Aucune photo en attente";
  else if (target === 1) label = "Envoyer 1 photo à ChatGPT";
  else label = `Envoyer ${target} photos à ChatGPT`;

  return (
    <main className="page workspace" data-panel={panel}>
      <TopBar email={me?.email} />
      <div className="groupbar">
        <div>
          <div className="group-title">
            <input
              className="group-name"
              aria-label="Nom du groupe"
              value={name}
              maxLength={60}
              onChange={(event) => {
                nameDirty.current = true;
                setName(event.target.value);
              }}
              onBlur={() => void saveName()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
            {data.group.code ? <span className="group-code">{data.group.code}</span> : null}
          </div>
          <p className="group-stats">
            {pending} dans le lot
            {data.photos.length - pending > 0 ? ` · ${data.photos.length - pending} en historique` : ""}
            {data.captures[0] ? ` · dernière extraction ${formatWhen(data.captures[0].createdAt)}` : ""}
          </p>
        </div>
        <div className="group-actions">
          {needsKey ? null : (
            <button type="button" className="lime" disabled={sending || target === 0} onClick={() => void send()}>
              {label}
            </button>
          )}
          {needsKey ? null : (
            <button type="button" className="ghost" disabled={packing || target === 0} onClick={() => void preparePacket()}>
              {packing ? "Préparation du PDF…" : "PDF pour l’application"}
            </button>
          )}
          {packetOpen ? (
            <div className="reply-box">
              <p className="hint" style={{ margin: 0 }}>
                Dépose codecapture.pdf dans le chat ChatGPT déjà ouvert, copie sa réponse, puis colle-la ici.
              </p>
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="Colle ici la réponse de ChatGPT"
              />
              <button type="button" className="lime" disabled={sending || !reply.trim()} onClick={() => void importReply()}>
                {sending ? "Lecture…" : "Mettre les fichiers dans l’app"}
              </button>
            </div>
          ) : null}
          {data.photos.some((photo) => photo.captureId) ? (
            <label className="check">
              <input
                type="checkbox"
                checked={includeSent}
                onChange={(event) => setIncludeSent(event.target.checked)}
              />
              Inclure les photos déjà envoyées
            </label>
          ) : null}
          <button
            type="button"
            className="lime"
            disabled={!data.photos.some((photo) => !photo.captureId)}
            onClick={() => {
              const waiting = data.photos.filter((photo) => !photo.captureId);
              const shots = waiting.slice(-8);
              void copyPhotoSet(shots.map((photo) => photo.url))
                .then(() => toast(shots.length > 1 ? `${shots.length} photos copiées` : "Photo copiée"))
                .catch((error) => toast(error instanceof Error ? error.message : "Copie impossible."));
            }}
          >
            Copier les photos
          </button>
          <span className="insert-pair">
            <button type="button" className="ghost" onClick={() => void insertClipboard()}>
              Insérer
            </button>
            <span className={`insert-dot ${insertDot}`} aria-hidden="true" />
          </span>
        </div>
      </div>
      {banner ? <p className="banner">{banner}</p> : null}
      {!includeSent && pending > MAX_PHOTOS_PER_SEND ? (
        <p className="hint" style={{ padding: "8px 16px 0" }}>
          Les {MAX_PHOTOS_PER_SEND} plus anciennes partent maintenant. Relance ensuite pour la suite.
        </p>
      ) : null}
      <div className="switch">
        {(
          [
            ["camera", "Caméra"],
            ["photos", "Photos"],
            ["fichiers", "Fichiers"],
          ] as const
        ).map(([id, text]) => (
          <button key={id} type="button" className={panel === id ? "on" : ""} onClick={() => setPanel(id)}>
            {text}
          </button>
        ))}
      </div>
      <div className="grid">
        <div className="side">
        <section className="pane pane-photos">
          <div className="pane-head">
            <h2>Lot en cours</h2>
            <span className="muted">{pending} photo{pending > 1 ? "s" : ""}</span>
          </div>
          {(() => {
            const shots = data.photos.filter((photo) => !photo.captureId);
            const index = shots.length ? Math.min(lotIndex, shots.length - 1) : 0;
            const photo = shots[index];
            return (
              <article className="lot-card lot-one">
                <div className="lot-nav">
                  <button type="button" aria-label="Photo précédente" disabled={!photo || index === 0} onClick={() => setLotIndex(index - 1)}>
                    ‹
                  </button>
                  <span>{photo ? `${index + 1}/${shots.length}` : "0/0"}</span>
                  <button
                    type="button"
                    aria-label="Photo suivante"
                    disabled={!photo || index === shots.length - 1}
                    onClick={() => setLotIndex(index + 1)}
                  >
                    ›
                  </button>
                </div>
                <div className="lot-frame">
                  {photo ? (
                    <button type="button" className="shot" onClick={() => setOpenPhoto(photo.url)}>
                      <img src={photo.url} alt={`Photo du ${formatWhen(photo.createdAt)}`} />
                    </button>
                  ) : (
                    <p className="lot-hold">
                      {data.photos.length
                        ? "Lot vide. Les photos traitées sont dans l’historique."
                        : "Aucune photo pour l’instant."}
                    </p>
                  )}
                </div>
                <div className="frame-meta">
                  <span>{photo ? formatWhen(photo.createdAt) : "En attente"}</span>
                  {photo ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirmId === photo.id) void removePhoto(photo.id);
                        else setConfirmId(photo.id);
                      }}
                    >
                      {confirmId === photo.id ? "Confirmer" : "Retirer"}
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              </article>
            );
          })()}
          {data.photos.some((photo) => photo.captureId) ? (
            <details className="history-photos">
              <summary>Historique · {data.photos.length - pending}</summary>
              <div className="history-grid">
                {[...data.photos].reverse().filter((photo) => photo.captureId).map((photo) => (
                  <article key={photo.id} className="lot-card past">
                    <button type="button" className="shot" onClick={() => setOpenPhoto(photo.url)}>
                      <img src={photo.url} alt={`Photo du ${formatWhen(photo.createdAt)}`} />
                    </button>
                    <div className="frame-meta">
                      <span>{formatWhen(photo.createdAt)}</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirmId === photo.id) void removePhoto(photo.id);
                          else setConfirmId(photo.id);
                        }}
                      >
                        {confirmId === photo.id ? "Confirmer" : "Retirer"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </details>
          ) : null}
          <details className="consignes">
            <summary>Consignes pour l’agent</summary>
            <label className="field">
              <span>Ce que ChatGPT doit déjà savoir</span>
              <textarea
                value={brief}
                maxLength={4000}
                onChange={(event) => {
                  setBriefDirty(true);
                  setBrief(event.target.value);
                }}
              />
            </label>
            <button type="button" className="ghost" onClick={() => void saveBrief()} disabled={!briefDirty}>
              Enregistrer les consignes
            </button>
          </details>
        </section>
        <CameraPane
          groupId={groupId}
          cameras={data.cameras ?? []}
          intervalSec={data.group.intervalSec}
          onIntervalChange={(seconds) => void changeInterval(seconds)}
          onCapture={upload}
          onToast={toast}
          onShowQr={openQr}
          ownerName={me?.name ?? ""}
        />
        </div>
        <FileStage
          captures={data.captures}
          photos={data.photos}
          captureId={captureId}
          onSelectCapture={(id) => {
            setFollowLatest(false);
            setCaptureId(id);
          }}
          onSaveFile={async ({ captureId: target, filename, content, archivePending }) => {
            const res = await fetch(`/api/groups/${groupId}/files`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ captureId: target, filename, content, archivePending }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload.error || "Enregistrement impossible.");
            if (payload.capture?.id) {
              setFollowLatest(true);
              setCaptureId(payload.capture.id);
            }
            toast("Fichier enregistré");
            await reload();
          }}
          onToast={toast}
          focusFile={focusFile}
        />
      </div>
      {openPhoto ? (
        <div className="lightbox" onClick={() => setOpenPhoto(null)}>
          <button type="button" onClick={() => setOpenPhoto(null)}>
            Fermer
          </button>
          <img src={openPhoto} alt="Photo agrandie" />
        </div>
      ) : null}
      {wide && !handheld && qrOpen ? (
        <div className="qr-modal" role="dialog" aria-modal="true" aria-label="Connecter un téléphone" onClick={closeQr}>
          <div className="qr-card">
            <div className="qr-frame" onClick={(event) => event.stopPropagation()}>
              <QrMark path={data.group.code ? `/${data.group.code}` : `/groupe/${groupId}`} label="QR code pour connecter un téléphone à ce groupe" />
            </div>
            <p>Scanne avec chaque téléphone. Plusieurs peuvent photographier en même temps.</p>
            <p className="muted">Même compte, puis active la caméra.</p>
            {phoneCount > 0 ? (
              <p className="tally">{phoneCount > 1 ? `${phoneCount} téléphones connectés` : "1 téléphone connecté"}</p>
            ) : (
              <p className="muted">Aucun téléphone connecté.</p>
            )}
          </div>
        </div>
      ) : null}
      <Toast msg={msg} />
    </main>
  );
}
