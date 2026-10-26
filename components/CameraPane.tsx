"use client";

import { useEffect, useRef, useState } from "react";
import { INTERVALS } from "@/lib/constants";
import type { CameraDTO } from "@/lib/types";
import { deviceId } from "./device";
import { formatRemain } from "./format";
import { fileToJpeg, frameFromVideo } from "./images";
import { TipButton } from "./TipButton";

type Props = {
  groupId: string;
  cameras: CameraDTO[];
  intervalSec: number;
  onIntervalChange: (seconds: number) => void;
  onCapture: (blob: Blob) => Promise<void>;
  onToast: (message: string) => void;
  onShowQr: () => void;
  ownerName?: string;
};

export function CameraPane({ groupId, cameras, intervalSec, onIntervalChange, onCapture, onToast, onShowQr, ownerName = "" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);
  const onCaptureRef = useRef(onCapture);
  const onToastRef = useRef(onToast);
  const shootRef = useRef<() => Promise<void>>(async () => {});
  const lastError = useRef("");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [flash, setFlash] = useState(false);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hidden, setHidden] = useState(false);
  const [secure, setSecure] = useState(true);
  const [cameraError, setCameraError] = useState("");
  const [wide, setWide] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [selfId, setSelfId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [ownInterval, setOwnInterval] = useState(intervalSec);
  const readyRef = useRef(false);
  const runningRef = useRef(false);
  const facingRef = useRef(facing);
  const enableRef = useRef(enableCamera);

  onCaptureRef.current = onCapture;
  onToastRef.current = onToast;
  readyRef.current = ready;
  runningRef.current = running;
  facingRef.current = facing;
  enableRef.current = enableCamera;

  useEffect(() => {
    setSecure(window.isSecureContext);
    setSelfId(deviceId());
    const media = window.matchMedia("(min-width: 901px)");
    const apply = () => setWide(media.matches);
    apply();
    setLayoutReady(true);
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!wide) return;
    setRunning(false);
    setReady(false);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [wide]);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
        };
        const next = (await nav.wakeLock?.request("screen")) ?? null;
        if (!next) return;
        if (cancelled) {
          await next.release();
          return;
        }
        lock = next;
      } catch {
        lock = null;
      }
    };
    void request();
    const onVis = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release();
    };
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(clock);
  }, [running]);

  async function shoot() {
    const video = videoRef.current;
    if (!video) throw new Error("La caméra n'est pas prête.");
    setFlash(true);
    window.setTimeout(() => setFlash(false), 140);
    const blob = await frameFromVideo(video);
    await onCaptureRef.current(blob);
  }
  shootRef.current = shoot;

  useEffect(() => {
    if (!running) {
      setNextAt(null);
      return;
    }
    let cancelled = false;
    let timer = 0;
    const schedule = (delay: number) => {
      setNextAt(Date.now() + delay);
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        if (document.hidden) {
          schedule(1000);
          return;
        }
        try {
          await shootRef.current();
          lastError.current = "";
        } catch (error) {
          const message = error instanceof Error ? error.message : "Photo impossible.";
          if (lastError.current !== message) {
            lastError.current = message;
            onToastRef.current(message);
          }
        }
        if (!cancelled) schedule(ownInterval * 1000);
      }, delay);
    };
    schedule(ownInterval * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [running, ownInterval]);

  async function enableCamera(nextFacing: "environment" | "user") {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Ce navigateur ne donne pas accès à la caméra.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: nextFacing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setFacing(nextFacing);
      setReady(true);
    } catch (error) {
      setReady(false);
      setCameraError(explainCamera(error));
    }
  }

  useEffect(() => {
    setOwnInterval(intervalSec);
  }, [intervalSec]);

  useEffect(() => {
    let stop = false;
    const media = window.matchMedia("(max-width: 900px), (pointer: coarse) and (max-device-width: 1100px)");
    const beat = async () => {
      if (stop || document.hidden || !media.matches) return;
      const res = await fetch(`/api/groups/${groupId}/camera`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: deviceId(),
          phone: media.matches,
          camera: readyRef.current,
          running: runningRef.current,
          intervalSec: ownInterval,
          givenName: media.matches ? ownerName : "",
        }),
      });
      if (!res.ok || stop) return;
      const payload = (await res.json()) as {
        command?: { action?: string; intervalSec?: number } | null;
      };
      const command = payload.command;
      if (!command?.action) return;
      if (command.action === "interval" && command.intervalSec) setOwnInterval(command.intervalSec);
      if (command.action === "stop") setRunning(false);
      if (!media.matches) return;
      if (command.action === "shoot") {
        try {
          if (!readyRef.current) await enableRef.current(facingRef.current);
          await shootRef.current();
        } catch (error) {
          onToastRef.current(error instanceof Error ? error.message : "Photo impossible.");
        }
      }
      if (command.action === "start") {
        try {
          if (!readyRef.current) await enableRef.current(facingRef.current);
          await shootRef.current();
          setRunning(true);
        } catch (error) {
          onToastRef.current(error instanceof Error ? error.message : "Photo impossible.");
        }
      }
    };
    void beat();
    const timer = window.setInterval(() => void beat(), 5000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [groupId, ownInterval, ownerName]);

  function disableCamera() {
    setRunning(false);
    setReady(false);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function startSeries() {
    try {
      await shoot();
      setRunning(true);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Photo impossible.");
    }
  }

  async function importFiles(list: FileList | null) {
    const files = [...(list ?? [])];
    if (!files.length) return;
    for (const file of files) {
      try {
        const blob = await fileToJpeg(file);
        await onCaptureRef.current(blob);
      } catch (error) {
        onToast(error instanceof Error ? error.message : "Import impossible.");
      }
    }
  }

  const remain = nextAt ? formatRemain(nextAt - now) : null;
  const linked = cameras.filter((camera) => camera.phone && camera.deviceId !== selfId);
  const selected = linked.find((camera) => camera.deviceId === selectedId) ?? null;
  const aimed = selected?.running === true;

  useEffect(() => {
    if (!wide) return;
    const next = linked.some((camera) => camera.deviceId === selectedId) ? selectedId : (linked[0]?.deviceId ?? "");
    if (next !== selectedId) setSelectedId(next);
  }, [wide, linked, selectedId]);

  async function sendCommand(command: "start" | "stop" | "shoot" | "interval", seconds?: number) {
    if (!selected) {
      onToast("Choisis un téléphone.");
      return;
    }
    const res = await fetch(`/api/groups/${groupId}/camera`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "command", targetId: selected.deviceId, command, intervalSec: seconds }),
    });
    if (!res.ok) onToast("Le téléphone n’a pas reçu la commande.");
  }

  return (
    <section className="pane pane-camera">
      <div className="pane-head">
        <h2>Caméra</h2>
        {running || aimed ? <span className="tally">Série en cours</span> : null}
      </div>
      {layoutReady && !wide ? (
        <div className={ready ? "viewfinder filming" : "viewfinder"}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              opacity: ready ? 1 : 0,
              transform: facing === "user" ? "scaleX(-1)" : undefined,
            }}
          />
          {!ready ? (
            <div className="viewfinder-empty">
              <p>Place le téléphone devant l’écran, le tableau ou la feuille.</p>
              <button type="button" className="lime" onClick={() => enableCamera(facing)}>
                Activer la caméra
              </button>
            </div>
          ) : null}
          <div className={flash ? "flash on" : "flash"} />
        </div>
      ) : (
        <div className="phone-stage">
          {linked.length === 0 ? (
            <p className="phone-empty">Aucun téléphone</p>
          ) : (
            <ul>
              {linked.map((camera) => (
                <li key={camera.deviceId}>
                  <button
                    type="button"
                    className={camera.deviceId === selectedId ? "on" : ""}
                    onClick={() => setSelectedId(camera.deviceId)}
                  >
                    <span>{camera.label}</span>
                    <span>{camera.camera ? "Caméra allumée" : "Connecté"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="cam-controls">
        <label className="field">
          <span>{wide ? "Une photo toutes les, pour le téléphone choisi" : "Une photo toutes les"}</span>
          <select
            value={String(wide ? selected?.intervalSec || intervalSec : ownInterval)}
            disabled={wide && !selected}
            onChange={(event) => {
              const seconds = Number(event.target.value);
              if (wide) void sendCommand("interval", seconds);
              else {
                setOwnInterval(seconds);
                onIntervalChange(seconds);
              }
            }}
          >
            {INTERVALS.map((item) => (
              <option key={item.sec} value={item.sec}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {!wide && running ? (
          <p className="remain">
            {hidden ? "Série en pause — reviens sur cet onglet" : `Prochaine photo dans ${remain}`}
          </p>
        ) : null}
        {cameraError ? <p className="form-error">{cameraError}</p> : null}
        {layoutReady && wide ? (
          <div className="icon-row">
            <TipButton label="QR" className="icon-btn lime" onClick={onShowQr}>
              <Glyph name="qr" />
            </TipButton>
            {aimed ? (
              <TipButton label="Arrêter" className="icon-btn" onClick={() => void sendCommand("stop")}>
                <Glyph name="stop" />
              </TipButton>
            ) : (
              <TipButton label="Démarrer" className="icon-btn lime" disabled={!selected} onClick={() => void sendCommand("start")}>
                <Glyph name="play" />
              </TipButton>
            )}
            <TipButton label="Photo" className="icon-btn" disabled={!selected} onClick={() => void sendCommand("shoot")}>
              <Glyph name="shutter" />
            </TipButton>
            <TipButton label="Importer" className="icon-btn" onClick={() => fileRef.current?.click()}>
              <Glyph name="import" />
            </TipButton>
            <TipButton label="Appareil" className="icon-btn" onClick={() => nativeRef.current?.click()}>
              <Glyph name="roll" />
            </TipButton>
          </div>
        ) : (
          <>
            <div className="row">
              {!running ? (
                <button type="button" className="lime" disabled={!ready} onClick={startSeries}>
                  Démarrer la série
                </button>
              ) : (
                <button type="button" className="ghost" onClick={() => setRunning(false)}>
                  Arrêter
                </button>
              )}
              <button
                type="button"
                className="ghost"
                disabled={!ready}
                onClick={() => {
                  void shoot().catch((error) => onToast(error instanceof Error ? error.message : "Photo impossible."));
                }}
              >
                Photo maintenant
              </button>
            </div>
            <div className="row">
              {ready ? (
                <button type="button" className="ghost" onClick={() => enableCamera(facing === "environment" ? "user" : "environment")}>
                  Changer de caméra
                </button>
              ) : null}
              {ready ? (
                <button type="button" className="ghost" onClick={disableCamera}>
                  Couper la caméra
                </button>
              ) : null}
            </div>
            <p className="hint">Garde cette page ouverte. Le même compte doit être connecté sur l’ordinateur.</p>
          </>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          void importFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={nativeRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          void importFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </section>
  );
}

function explainCamera(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") return "Autorise la caméra pour ce site, puis réessaie.";
  if (name === "NotFoundError") return "Aucune caméra détectée sur cet appareil.";
  if (name === "NotReadableError") return "La caméra est déjà utilisée par une autre application.";
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "La caméra automatique a besoin d’une adresse https.";
  }
  return "Impossible d’ouvrir la caméra.";
}

function Glyph({ name }: { name: string }) {
  const props = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "qr") {
    return (
      <svg {...props}>
        <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
        <path d="M8 8h3v3H8zM13 8h3M13 11h3M8 13h3v3M13 14h1M16 16h2" />
      </svg>
    );
  }
  if (name === "play") {
    return (
      <svg {...props}>
        <path d="M8 5l11 7-11 7z" />
      </svg>
    );
  }
  if (name === "stop") {
    return (
      <svg {...props}>
        <rect x="6" y="6" width="12" height="12" />
      </svg>
    );
  }
  if (name === "shutter") {
    return (
      <svg {...props}>
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    );
  }
  if (name === "import") {
    return (
      <svg {...props}>
        <path d="M12 4v10M8 10l4 4 4-4M5 19h14" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <rect x="4" y="6" width="16" height="12" />
      <path d="M8 6l1.5-2h5L16 6" />
    </svg>
  );
}
