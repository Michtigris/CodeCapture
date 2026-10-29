"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_PROMPT, DEFAULT_BRIEF, MAX_PHOTOS_PER_SEND } from "@/lib/constants";
import { INSERT_DAY_MS, parseInsert } from "@/lib/insert";
import type { CameraDTO, GroupPayload, PublicUser } from "@/lib/types";
import { CameraPane } from "./CameraPane";
import { fileToJpeg } from "./images";
import { copyPhotoSet, copyText } from "./copy";
import { deviceId } from "./device";
import { FileStage } from "./FileStage";
import { QrMark } from "./QrMark";
import { formatWhen } from "./format";
import { Toast, useToast } from "./toast";
import { TipButton } from "./TipButton";
import { TopBar } from "./TopBar";

function phoneOwner(camera: CameraDTO, members: string[]) {
  if (camera.ownerName) return camera.ownerName;
  const raw = camera.label.replace(/^Téléphone\s+/i, "").replace(/\s+\d+$/, "").trim();
  const matches = members.filter((name) => name.split(/\s+/)[0]?.toLowerCase() === raw.toLowerCase());
  if (matches.length === 1) return matches[0];
  return camera.label || "Téléphone";
}

function rosterRows(members: string[], cameras: CameraDTO[]) {
  const rows = members.map((name) => ({ name, phone: false }));
  for (const camera of cameras) {
    if (camera.phone === false) continue;
    rows.push({ name: phoneOwner(camera, members), phone: true });
  }
  return rows.sort((a, b) => {
    const left = a.phone ? `${a.name} [PHONE]` : a.name;
    const right = b.phone ? `${b.name} [PHONE]` : b.name;
    return left.localeCompare(right, "fr", { sensitivity: "base" });
  });
}

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
  const [nameLive, setNameLive] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const rosterRef = useRef<HTMLDivElement>(null);
  const [insertDot, setInsertDot] = useState<"idle" | "ok" | "bad" | "same">("idle");
  const [focusFile, setFocusFile] = useState<{ name: string; nonce: number } | null>(null);
  const insertLock = useRef(false);
  const galleryRef = useRef<HTMLInputElement>(null);
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
    document.title = `${data.group.name} · CodeCapture`;
  }, [data]);

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

  useEffect(() => {
    if (!rosterOpen) return;
    function onPointer(event: PointerEvent) {
      if (!rosterRef.current?.contains(event.target as Node)) setRosterOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setRosterOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [rosterOpen]);

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

  async function importGallery(list: FileList | null) {
    const files = [...(list ?? [])];
    if (!files.length) return;
    let sent = 0;
    for (const file of files) {
      try {
        const blob = await fileToJpeg(file);
        await upload(blob);
        sent += 1;
      } catch (error) {
        toast(error instanceof Error ? error.message : "Import impossible.");
      }
    }
    if (sent) toast(sent > 1 ? `${sent} photos ajoutées au lot` : "Photo ajoutée au lot");
  }

  async function saveName() {
    if (!data) return;
    const next = name.trim();
    if (!next || next === data.group.name) {
      setName(data.group.name);
      nameDirty.current = false;
      return;
    }
    if (me && next.toLowerCase() === me.email.toLowerCase()) {
      setName(data.group.name);
      nameDirty.current = false;
      toast("Le nom du groupe n'est pas l'email du compte.");
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

  async function clearHistory() {
    if (!data) return;
    const history = data.photos.filter((photo) => photo.captureId);
    if (!history.length) return;
    const count = history.length;
    if (!window.confirm(`Supprimer les ${count} photos de l'historique ? Elles seront effacées du serveur.`)) return;
    const res = await fetch(`/api/groups/${groupId}/photos`, { method: "DELETE" });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      toast(payload.error || "Suppression impossible.");
      return;
    }
    if (openPhoto && history.some((photo) => openPhoto.includes(photo.id))) setOpenPhoto(null);
    toast(count > 1 ? `${count} photos supprimées` : "Photo supprimée");
    await reload();
  }

  async function preparePacket() {
    if (!data || packing || targetCount() === 0) return;
    setPacking(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/packet`);
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
    return Math.min(waiting, MAX_PHOTOS_PER_SEND);
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
        body: JSON.stringify({ all: false }),
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
        <TopBar name={me?.name} />
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
        <TopBar name={me?.name} />
        <p className="boot wrap">Chargement du groupe…</p>
      </main>
    );
  }

  const pending = data.photos.filter((photo) => !photo.captureId).length;
  const target = Math.min(pending, MAX_PHOTOS_PER_SEND);
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
    flashDot("ok", 1000);
    await reload();
  }

  const groupBrief = data.group.brief;
  async function copyPrompt() {
    const note = groupBrief.trim();
    const extra = note && note !== DEFAULT_BRIEF.trim() ? `\n\nConsignes du groupe :\n${note}` : "";
    try {
      await copyText(CHAT_PROMPT + extra);
      toast("Prompt copié");
    } catch {
      toast("Copie impossible.");
    }
  }

  let label = "Envoyer à ChatGPT";
  if (sending) label = "Lecture des photos…";
  else if (needsKey) label = "Ajouter la clé OpenAI";
  else if (target === 0) label = "Aucune photo en attente";
  else if (target === 1) label = "Envoyer 1 photo à ChatGPT";
  else label = `Envoyer ${target} photos à ChatGPT`;

  return (
    <main className="page workspace" data-panel={panel}>
      <TopBar name={me?.name} />
      <div className="groupbar">
        <div>
          <div className="group-title">
            <input
              className="group-name"
              aria-label="Nom du groupe"
              name="group-label"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              readOnly={!nameLive}
              value={name}
              size={Math.max(name.length, 1)}
              maxLength={60}
              onFocus={() => setNameLive(true)}
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
            <div className="roster" ref={rosterRef}>
              <button
                type="button"
                className="roster-btn"
                aria-expanded={rosterOpen}
                aria-haspopup="listbox"
                onClick={() => setRosterOpen((open) => !open)}
              >
                Membre
                <span className="roster-caret" aria-hidden="true" />
              </button>
              {rosterOpen ? (
                <div className="roster-pop shard" role="listbox" aria-label="Membres du groupe">
                  <i className="tick tl" />
                  <i className="tick tr" />
                  <i className="tick bl" />
                  <i className="tick br" />
                  <ul>
                    {rosterRows(data.members ?? [], data.cameras ?? []).map((row, index) => (
                      <li key={`${row.phone ? "p" : "m"}-${index}-${row.name}`} role="option">
                        {row.name}
                        {row.phone ? <span className="roster-tag"> [PHONE]</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
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
          <p className="group-stats">{pending} dans le lot</p>
          <TipButton label="Copier le prompt à coller avec les photos" className="ghost prompt-copy" onClick={() => void copyPrompt()}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="8" y="3" width="8" height="4" rx="1" />
              <path d="M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2" />
              <path d="M9 12h6M9 16h6" />
            </svg>
            Prompt
          </TipButton>
          <button
            type="button"
            className="lime"
            disabled={!data.photos.some((photo) => !photo.captureId)}
            onClick={() => {
              const waiting = data.photos.filter((photo) => !photo.captureId);
              void copyPhotoSet(waiting.map((photo) => ({ id: photo.id, url: photo.url })))
                .then(async ({ ids, mode }) => {
                  const res = await fetch(`/api/groups/${groupId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ copiedIds: ids }),
                  });
                  if (!res.ok) {
                    toast(mode === "zipped" ? "Zip prêt, mais le lot n'a pas été noté." : "Photos copiées, mais le lot n'a pas été noté.");
                    return;
                  }
                  if (mode === "zipped") {
                    toast(`${ids.length} photos dans le zip — ouvre-le et glisse-les dans ChatGPT`);
                  } else {
                    toast("Photo copiée");
                  }
                  await reload();
                })
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
      {pending > MAX_PHOTOS_PER_SEND ? (
        <p className="hint" style={{ padding: "8px 16px 0" }}>
          Les {MAX_PHOTOS_PER_SEND} plus anciennes partent maintenant. Relance ensuite pour la suite.
        </p>
      ) : null}
      <div className="switch">
        <button type="button" onClick={() => galleryRef.current?.click()}>
          Galerie
        </button>
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void importGallery(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      <div className="grid">
        <div className="side">
        <section className="pane pane-photos">
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
                    <p className="lot-hold">En attente</p>
                  )}
                </div>
                {photo ? (
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
                ) : null}
              </article>
            );
          })()}
          {data.photos.some((photo) => photo.captureId) ? (
            <details className="history-photos">
              <summary>
                Historique · {data.photos.length - pending}
                {data.group.owner ? (
                  <button
                    type="button"
                    className="history-x"
                    aria-label="Supprimer les photos de l'historique"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void clearHistory();
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </summary>
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
          canArchive={data.group.owner === true}
          onArchive={async (filenames) => {
            const res = await fetch(`/api/groups/${groupId}/files`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ archive: filenames }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload.error || "Archivage impossible.");
            await reload();
          }}
          onRestore={async (filenames) => {
            const res = await fetch(`/api/groups/${groupId}/files`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ restore: filenames }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload.error || "Impossible de ramener.");
            await reload();
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
            <p>Scanne avec ton téléphone pour le transformer en caméra.</p>
            {phoneCount > 0 ? (
              <p className="tally">{phoneCount > 1 ? `${phoneCount} téléphones connectés` : "1 téléphone connecté"}</p>
            ) : null}
          </div>
        </div>
      ) : null}
      <Toast msg={msg} />
    </main>
  );
}
