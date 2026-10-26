"use client";

import { useEffect, useRef, useState } from "react";
import { INTERVALS } from "@/lib/constants";
import type { CameraDTO } from "@/lib/types";
import { deviceId, readCameraChoice, readPcCameras, writeCameraChoice, writePcCameras, type PcCamera } from "./device";
import { formatRemain } from "./format";
import { fileToJpeg, frameFromVideo } from "./images";
import { clampZoom, detectTarget, frameAtZoom, frameOnTarget, FULL, placeVideo, smoothLock, type NormRect } from "./targetLock";
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
  const finderRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cropRef = useRef<NormRect>(FULL);
  const zoomRef = useRef(1);
  const followRef = useRef(true);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const hardwareZoomRef = useRef<number | null>(null);
  const zoomRangeRef = useRef<ZoomRange | null>(null);
  const nativeBrokenRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);
  const onCaptureRef = useRef(onCapture);
  const onToastRef = useRef(onToast);
  const shootRef = useRef<() => Promise<void>>(async () => {});
  const greetedRef = useRef(false);
  const commandShotRef = useRef(false);
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
  const [follow, setFollow] = useState(true);
  const [locked, setLocked] = useState(false);
  const [mag, setMag] = useState(1);
  const [viewMag, setViewMag] = useState(1);
  const [pending, setPending] = useState<{ action: string; id: number } | null>(null);
  const [pcCameras, setPcCameras] = useState<PcCamera[]>([]);
  const [storedReady, setStoredReady] = useState(false);
  const ackRef = useRef(0);
  const streamDeviceRef = useRef("");
  const armDesk = useRef("");
  const selectedIdRef = useRef("");
  const wideRef = useRef(false);
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
  followRef.current = follow;
  selectedIdRef.current = selectedId;
  wideRef.current = wide;

  useEffect(() => {
    setSecure(window.isSecureContext);
    setSelfId(deviceId());
    setPcCameras(readPcCameras());
    const saved = readCameraChoice();
    if (saved) setSelectedId(saved);
    setStoredReady(true);
    const desktop = window.matchMedia("(min-width: 901px)");
    const handheld = window.matchMedia("(pointer: coarse) and (max-device-width: 1100px)");
    const apply = () => setWide(desktop.matches && !handheld.matches);
    apply();
    setLayoutReady(true);
    desktop.addEventListener("change", apply);
    handheld.addEventListener("change", apply);
    return () => {
      desktop.removeEventListener("change", apply);
      handheld.removeEventListener("change", apply);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!wide || selectedId.startsWith("pc:")) return;
    setRunning(false);
    setReady(false);
    streamDeviceRef.current = "";
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [wide, selectedId]);

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

  useEffect(() => {
    if (!pending) return;
    const phone = cameras.find((camera) => camera.deviceId === selectedId);
    if (phone?.ack === pending.id) setPending(null);
  }, [pending, cameras, selectedId]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      setPending((current) => {
        if (current?.id !== pending.id) return current;
        onToastRef.current("Le téléphone n'a pas répondu.");
        return null;
      });
    }, 20000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  async function shoot() {
    const video = videoRef.current;
    if (!video) throw new Error("La caméra n'est pas prête.");
    if (!video.videoWidth) await waitForFrame(video);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 140);
    const blob = await frameFromVideo(video, cropRef.current);
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
      const stream = await openPhoneCamera(nextFacing);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      const track = stream.getVideoTracks()[0];
      const range = track ? zoomRangeOf(track) : null;
      zoomRangeRef.current = range;
      nativeBrokenRef.current = !range;
      if (track) await focusTrack(track).catch(() => undefined);
      zoomRef.current = 1;
      hardwareZoomRef.current = null;
      cropRef.current = FULL;
      setMag(1);
      setLocked(false);
      setFacing(nextFacing);
      setReady(true);
    } catch (error) {
      setReady(false);
      setCameraError(explainCamera(error));
    }
  }

  async function openDesk() {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Ce navigateur ne donne pas accès à la caméra.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 1920 }, height: { ideal: 1440 } },
      });
      if (!selectedIdRef.current.startsWith("pc:")) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = stream.getVideoTracks()[0];
      const mediaId = track?.getSettings?.().deviceId || "chrome";
      const label = track?.label?.trim().slice(0, 80) || "Caméra de ce PC";
      streamRef.current?.getTracks().forEach((item) => item.stop());
      streamRef.current = stream;
      streamDeviceRef.current = mediaId;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((item) => item.stop());
        streamRef.current = null;
        return;
      }
      video.srcObject = stream;
      await video.play();
      const range = track ? zoomRangeOf(track) : null;
      zoomRangeRef.current = range;
      nativeBrokenRef.current = !range;
      if (track) await focusTrack(track).catch(() => undefined);
      zoomRef.current = 1;
      hardwareZoomRef.current = null;
      cropRef.current = FULL;
      setMag(1);
      setViewMag(1);
      setLocked(false);
      followRef.current = false;
      setFollow(false);
      setReady(true);
      const saved = [{ id: mediaId, label }];
      writePcCameras(saved);
      setPcCameras(saved);
      selectedIdRef.current = `pc:${mediaId}`;
      setSelectedId(`pc:${mediaId}`);
    } catch (error) {
      streamDeviceRef.current = "";
      setReady(false);
      setCameraError(explainCamera(error));
    }
  }

  useEffect(() => {
    setOwnInterval(intervalSec);
  }, [intervalSec]);

  useEffect(() => {
    if (!ready || wide || greetedRef.current) return;
    if (commandShotRef.current) {
      commandShotRef.current = false;
      greetedRef.current = true;
      return;
    }
    greetedRef.current = true;
    void shootRef.current().catch((error) => {
      greetedRef.current = false;
      onToastRef.current(error instanceof Error ? error.message : "Photo impossible.");
    });
  }, [ready, wide]);

  useEffect(() => {
    let stop = false;
    let busy = false;
    const media = window.matchMedia("(max-width: 900px), (pointer: coarse) and (max-device-width: 1100px)");
    const beat = async () => {
      if (stop || busy || document.hidden || !media.matches) return;
      busy = true;
      try {
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
            ack: ackRef.current || undefined,
          }),
        });
        if (!res.ok || stop) return;
        const payload = (await res.json()) as {
          command?: { id?: number; action?: string; intervalSec?: number } | null;
        };
        const command = payload.command;
        if (!command?.action) return;
        const commandId = Number(command.id) || 0;
        const done = () => {
          if (commandId) ackRef.current = commandId;
        };
        if (command.action === "interval" && command.intervalSec) setOwnInterval(command.intervalSec);
        if (command.action === "stop") setRunning(false);
        if (command.action === "interval" || command.action === "stop" || !media.matches) {
          done();
          return;
        }
        if (command.action === "shoot" || command.action === "start") {
          commandShotRef.current = true;
          if (command.action === "start") {
            followRef.current = true;
            setFollow(true);
            setOwnInterval(60);
            setRunning(true);
          }
          try {
            if (!readyRef.current) await enableRef.current(facingRef.current);
            await shootRef.current();
          } catch (error) {
            commandShotRef.current = false;
            onToastRef.current(error instanceof Error ? error.message : "Photo impossible.");
          } finally {
            done();
          }
        }
      } finally {
        busy = false;
      }
    };
    void beat();
    const timer = window.setInterval(() => void beat(), 400);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [groupId, ownInterval, ownerName]);

  useEffect(() => {
    if (!wide || !armDesk.current || !selectedId.startsWith("pc:")) return;
    armDesk.current = "";
    void openDesk();
  }, [wide, selectedId]);

  useEffect(() => {
    if (!ready) return;
    const video = videoRef.current;
    const finder = finderRef.current;
    if (!video || !finder) return;
    const sample = document.createElement("canvas");
    sample.width = 96;
    sample.height = 72;
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    let lock: NormRect | null = null;
    let misses = 0;
    let shown = 1;
    let stopped = false;
    let last = 0;

    const tick = (time: number) => {
      if (stopped) return;
      if (time - last > 120 && video.videoWidth && ctx) {
        last = time;
        let base = FULL;
        if (followRef.current) {
          ctx.drawImage(video, 0, 0, sample.width, sample.height);
          const found = detectTarget(ctx.getImageData(0, 0, sample.width, sample.height));
          if (found) {
            misses = 0;
            lock = smoothLock(lock, found);
          } else {
            misses += 1;
            lock = misses > 10 ? smoothLock(lock, FULL) : lock;
          }
          base = lock ?? FULL;
        } else {
          lock = null;
          misses = 0;
        }
        const desk = wideRef.current;
        const zoom = zoomRef.current;
        const aimed = !desk && followRef.current && base.w < 0.98 && base.h < 0.98;
        const crop = aimed ? frameOnTarget(base, zoom) : frameAtZoom(zoom);
        cropRef.current = crop;
        if (desk) {
          video.style.width = "100%";
          video.style.height = "100%";
          video.style.left = "0";
          video.style.top = "0";
          video.style.right = "0";
          video.style.bottom = "0";
          video.style.objectFit = "contain";
          video.style.transform = zoom > 1.01 ? `scale(${zoom})` : "none";
        } else {
          placeVideo(video, finder, crop, facingRef.current === "user");
        }
        const effective = desk ? zoom : 1 / crop.w;
        if (Math.abs(effective - shown) > 0.04) {
          shown = effective;
          setViewMag(effective);
        }
        setLocked((current) => (current === aimed ? current : aimed));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      stopped = true;
    };
  }, [ready]);

  useEffect(() => {
    const finder = finderRef.current;
    if (!finder || !ready) return;
    const distance = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy) || 1;
    };
    const start = (event: TouchEvent) => {
      if (event.touches.length === 2) pinchRef.current = { dist: distance(event.touches), zoom: zoomRef.current };
    };
    const move = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !pinchRef.current) return;
      event.preventDefault();
      const nextZoom = clampZoom(pinchRef.current.zoom * (distance(event.touches) / pinchRef.current.dist));
      zoomRef.current = nextZoom;
      setMag(nextZoom);
      pushNativeZoom();
    };
    const end = () => {
      pinchRef.current = null;
    };
    finder.addEventListener("touchstart", start, { passive: true });
    finder.addEventListener("touchmove", move, { passive: false });
    finder.addEventListener("touchend", end);
    finder.addEventListener("touchcancel", end);
    return () => {
      finder.removeEventListener("touchstart", start);
      finder.removeEventListener("touchmove", move);
      finder.removeEventListener("touchend", end);
      finder.removeEventListener("touchcancel", end);
    };
  }, [ready]);

  function pushNativeZoom() {
    const track = streamRef.current?.getVideoTracks()[0];
    const range = zoomRangeRef.current;
    if (!track || !range || nativeBrokenRef.current) return;
    const native = nativeZoomFor(zoomRef.current, range);
    if (hardwareZoomRef.current != null && Math.abs(hardwareZoomRef.current - native) < 0.03) return;
    hardwareZoomRef.current = native;
    void applyDeviceZoom(track, native).catch(() => {
      nativeBrokenRef.current = true;
      hardwareZoomRef.current = null;
    });
  }

  function toggleFollow() {
    const next = !followRef.current;
    followRef.current = next;
    if (!next && zoomRef.current < 1) zoomRef.current = 1;
    setFollow(next);
    setLocked(false);
  }

  function disableCamera() {
    setRunning(false);
    setReady(false);
    setLocked(false);
    zoomRef.current = 1;
    hardwareZoomRef.current = null;
    zoomRangeRef.current = null;
    nativeBrokenRef.current = false;
    cropRef.current = FULL;
    streamDeviceRef.current = "";
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function startSeries() {
    setRunning(true);
    try {
      await shoot();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Photo impossible.");
    }
  }

  async function activate() {
    followRef.current = true;
    setFollow(true);
    setOwnInterval(60);
    onIntervalChange(60);
    greetedRef.current = true;
    await enableCamera(facingRef.current);
    if (!streamRef.current) {
      greetedRef.current = false;
      return;
    }
    setRunning(true);
    try {
      await shoot();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Photo impossible.");
    }
  }

  async function startDesk() {
    setOwnInterval(60);
    onIntervalChange(60);
    greetedRef.current = true;
    if (!streamRef.current) await openDesk();
    if (!streamRef.current) return;
    setRunning(true);
    try {
      await shoot();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Photo impossible.");
    }
  }

  function chooseSource(id: string) {
    if (id.startsWith("pc:")) {
      if (selectedId.startsWith("pc:")) {
        void openDesk();
        return;
      }
      armDesk.current = "chrome";
      selectedIdRef.current = "pc:chrome";
      setSelectedId("pc:chrome");
      return;
    }
    setSelectedId(id);
  }

  function stopDesk() {
    disableCamera();
    setPcCameras([]);
    writePcCameras([]);
    setSelectedId("");
    writeCameraChoice("");
  }

  function forgetPc(id: string) {
    setPcCameras((current) => {
      const next = current.filter((item) => item.id !== id);
      writePcCameras(next);
      return next;
    });
    if (selectedId === `pc:${id}`) {
      disableCamera();
      setSelectedId("");
      writeCameraChoice("");
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
  const deskId = selectedId.startsWith("pc:") ? selectedId.slice(3) : "";
  const usingDesk = deskId.length > 0;
  const phoneKey = linked.map((camera) => camera.deviceId).join("|");

  useEffect(() => {
    if (!wide || !storedReady) return;
    const phoneIds = phoneKey ? phoneKey.split("|") : [];
    if (selectedId.startsWith("pc:") || phoneIds.includes(selectedId)) return;
    const next = phoneIds[0] || "";
    if (next !== selectedId) setSelectedId(next);
  }, [wide, storedReady, phoneKey, selectedId]);

  useEffect(() => {
    if (!storedReady || !selectedId) return;
    writeCameraChoice(selectedId);
  }, [storedReady, selectedId]);

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
    const payload = (await res.json().catch(() => ({}))) as { commandId?: number };
    if (!res.ok || typeof payload.commandId !== "number") {
      onToast("Le téléphone n’a pas reçu la commande.");
      return;
    }
    setPending({ action: command, id: payload.commandId });
  }

  return (
    <section className="pane pane-camera">
      <div className="pane-head">
        <h2>Caméra</h2>
        {running || aimed ? <span className="tally">Série en cours</span> : null}
      </div>
      {layoutReady && wide ? (
        <div className="phone-stage sources">
          {usingDesk ? null : (
            <button type="button" className="pc-add" onClick={() => chooseSource("pc:chrome")}>
              Caméra de ce PC
            </button>
          )}
          {pcCameras.length === 0 && linked.length === 0 ? (
            <p className="phone-empty">Connecte un téléphone, ou utilise la caméra de ce PC.</p>
          ) : (
            <ul>
              {usingDesk
                ? null
                : pcCameras.map((camera) => (
                    <li key={camera.id} className="source-row">
                      <button
                        type="button"
                        className={selectedId === `pc:${camera.id}` ? "on" : ""}
                        onClick={() => chooseSource(`pc:${camera.id}`)}
                      >
                        <span>{camera.label}</span>
                        <span>Ce PC</span>
                      </button>
                      <button type="button" className="source-drop" onClick={() => forgetPc(camera.id)}>
                        Retirer
                      </button>
                    </li>
                  ))}
              {linked.map((camera) => (
                <li key={camera.deviceId}>
                  <button
                    type="button"
                    className={camera.deviceId === selectedId ? "on" : ""}
                    onClick={() => chooseSource(camera.deviceId)}
                  >
                    <span>{camera.label}</span>
                    <span>{camera.camera ? "Caméra allumée" : "Connecté"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {layoutReady && (!wide || usingDesk) ? (
        <div ref={finderRef} className={`viewfinder${wide ? " desk" : ""}${ready ? " filming" : ""}`}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              opacity: ready ? 1 : 0,
              transform: !wide && facing === "user" ? "scaleX(-1)" : undefined,
            }}
          />
          {wide ? (
            <button type="button" className="desk-close" aria-label="Ne plus utiliser la caméra de ce PC" onClick={stopDesk}>
              ×
            </button>
          ) : null}
          {ready && locked ? <span className="lock-mark" /> : null}
          {ready ? (
            <div className="zoom-bar">
              <input
                type="range"
                min={1}
                max={10}
                step={0.1}
                value={mag}
                aria-label="Zoom, de ×1 à ×10"
                onChange={(event) => {
                  const nextZoom = clampZoom(Number(event.target.value));
                  zoomRef.current = nextZoom;
                  setMag(nextZoom);
                  pushNativeZoom();
                }}
              />
              <span>×{viewMag.toFixed(1)}</span>
              {wide ? null : (
                <button type="button" className={follow ? "on" : ""} aria-pressed={follow} onClick={toggleFollow}>
                  Suivi
                </button>
              )}
            </div>
          ) : null}
          {!ready ? (
            <div className="viewfinder-empty">
              {wide ? (
                <p>Démarre le cycle. Les fichiers restent sur cet écran.</p>
              ) : (
                <>
                  <p>Place le téléphone devant l’écran, le tableau ou la feuille.</p>
                  <button type="button" className="lime" onClick={() => void activate()}>
                    Activer la caméra
                  </button>
                </>
              )}
            </div>
          ) : null}
          <div className={flash ? "flash on" : "flash"} />
        </div>
      ) : null}
      <div className="cam-controls">
        <label className="field">
          <span>{wide && !usingDesk ? "Une photo toutes les, pour le téléphone choisi" : "Une photo toutes les"}</span>
          <select
            className={pending?.action === "interval" ? "armed" : ""}
            value={String(wide && !usingDesk ? selected?.intervalSec || intervalSec : ownInterval)}
            disabled={wide && !usingDesk && !selected}
            onChange={(event) => {
              const seconds = Number(event.target.value);
              if (wide && !usingDesk) void sendCommand("interval", seconds);
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
        {(!wide || usingDesk) && running ? (
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
            {usingDesk ? (
              running ? (
                <TipButton label="Arrêter le cycle" className="icon-btn" onClick={() => setRunning(false)}>
                  <Glyph name="stop" />
                </TipButton>
              ) : (
                <TipButton label="Démarrer le cycle" className="icon-btn lime" disabled={!deskId} onClick={() => void startDesk()}>
                  <Glyph name="play" />
                </TipButton>
              )
            ) : pending?.action === "stop" || (pending?.action !== "start" && aimed) ? (
              <TipButton
                label="Arrêter"
                className={pending?.action === "stop" ? "icon-btn armed" : "icon-btn"}
                pressed={pending?.action === "stop"}
                onClick={() => void sendCommand("stop")}
              >
                <Glyph name="stop" />
              </TipButton>
            ) : (
              <TipButton
                label="Démarrer"
                className={pending?.action === "start" ? "icon-btn armed" : "icon-btn lime"}
                pressed={pending?.action === "start"}
                disabled={!selected}
                onClick={() => void sendCommand("start")}
              >
                <Glyph name="play" />
              </TipButton>
            )}
            {usingDesk ? (
              <TipButton
                label="Photo"
                className="icon-btn"
                disabled={!ready}
                onClick={() => {
                  void shoot().catch((error) => onToast(error instanceof Error ? error.message : "Photo impossible."));
                }}
              >
                <Glyph name="shutter" />
              </TipButton>
            ) : (
              <TipButton
                label="Photo"
                className={pending?.action === "shoot" ? "icon-btn armed" : "icon-btn"}
                pressed={pending?.action === "shoot"}
                disabled={!selected}
                onClick={() => void sendCommand("shoot")}
              >
                <Glyph name="shutter" />
              </TipButton>
            )}
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
            <p className="hint">
              {ready
                ? "Suivi recadre sur le tableau, l’écran ou la feuille, et suit si le téléphone bouge."
                : "Garde cette page ouverte. Le même compte doit être connecté sur l’ordinateur."}
            </p>
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

type ZoomRange = { min: number; max: number; step?: number };

function zoomRangeOf(track: MediaStreamTrack): ZoomRange | null {
  const caps = track.getCapabilities?.() as { zoom?: ZoomRange } | undefined;
  const zoom = caps?.zoom;
  if (!zoom || !(zoom.max > zoom.min)) return null;
  return zoom;
}

function waitForFrame(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      video.removeEventListener("loadeddata", done);
      reject(new Error("La caméra n'est pas prête."));
    }, 2500);
    const done = () => {
      if (!video.videoWidth) return;
      window.clearTimeout(timer);
      video.removeEventListener("loadeddata", done);
      resolve();
    };
    video.addEventListener("loadeddata", done);
    done();
  });
}

function nativeZoomFor(slider: number, range: ZoomRange): number {
  const clamped = Math.min(range.max, Math.max(range.min, slider));
  if (!range.step || range.step <= 0) return clamped;
  const steps = Math.round((clamped - range.min) / range.step);
  return Math.min(range.max, Math.max(range.min, range.min + steps * range.step));
}

function openPhoneCamera(facing: "environment" | "user") {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1920 },
      height: { ideal: 1440 },
    },
  });
}

async function focusTrack(track: MediaStreamTrack) {
  const caps = track.getCapabilities?.() as {
    focusMode?: string[];
    pointsOfInterest?: unknown;
  } | undefined;
  const advanced: Record<string, unknown> = {};
  if (caps?.focusMode?.includes("continuous")) advanced.focusMode = "continuous";
  else if (caps?.focusMode?.includes("single-shot")) advanced.focusMode = "single-shot";
  if (caps?.pointsOfInterest) advanced.pointsOfInterest = [{ x: 0.5, y: 0.5 }];
  if (!Object.keys(advanced).length) return;
  await track.applyConstraints({ advanced: [advanced as MediaTrackConstraintSet] });
}

async function applyDeviceZoom(track: MediaStreamTrack, zoom: number) {
  const caps = track.getCapabilities?.() as { focusMode?: string[] } | undefined;
  if (caps?.focusMode?.includes("continuous")) {
    try {
      await track.applyConstraints({
        advanced: [{ zoom, focusMode: "continuous" } as MediaTrackConstraintSet],
      });
      return;
    } catch {
      /* le zoom seul, puis la mise au point */
    }
  }
  await track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] });
  await focusTrack(track).catch(() => undefined);
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
