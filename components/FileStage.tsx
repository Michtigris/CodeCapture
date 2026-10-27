"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { decodeCodeEntities, fileStamp, INSERT_WEEK_MS } from "@/lib/insert";
import { folderLabel, normalizeFolder, splitPath } from "@/lib/paths";
import type { CaptureDTO, ExtractedFile, PhotoDTO } from "@/lib/types";
import { copyText, downloadText } from "./copy";
import { formatWhen } from "./format";
import { presentCode } from "./presentCode";
import { downloadBlob, zipFolder } from "./zip";

const EMPTY_FILES: ExtractedFile[] = [];
const CAPTURE_TAB = "__capture";

type OcrWord = {
  key: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

function readOcrWords(data: {
  blocks?: {
    paragraphs?: {
      lines?: {
        words?: { text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }[];
      }[];
    }[];
  }[] | null;
}, width: number, height: number): OcrWord[] {
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const lineWords = line.words ?? [];
        lineWords.forEach((word, index) => {
          const box = word.bbox;
          const raw = word.text?.trim() ?? "";
          if (!box || !raw || (word.confidence ?? 0) < 20) return;
          const w = ((box.x1 - box.x0) / width) * 100;
          const h = ((box.y1 - box.y0) / height) * 100;
          if (w < 0.3 || h < 0.4) return;
          words.push({
            key: `${words.length}-${raw}`,
            text: index === lineWords.length - 1 ? `${raw}\n` : `${raw} `,
            x: (box.x0 / width) * 100,
            y: (box.y0 / height) * 100,
            w,
            h,
          });
        });
      }
    }
  }
  return words;
}

type Props = {
  captures: CaptureDTO[];
  photos: PhotoDTO[];
  captureId: string | null;
  onSelectCapture: (id: string) => void;
  onSaveFile: (input: { captureId: string | null; filename: string; content: string; archivePending?: boolean }) => Promise<void>;
  onToast: (message: string) => void;
  focusFile?: { name: string; nonce: number } | null;
  canArchive?: boolean;
  onArchive?: (filenames: string[]) => Promise<void>;
  onRestore?: (filenames: string[]) => Promise<void>;
};

function isNotepad(filename: string) {
  return /^\d+\.txt$/i.test(splitPath(filename).name);
}

function tabLabel(filename: string) {
  const name = splitPath(filename).name;
  const numbered = name.match(/^(\d+)\.txt$/i);
  return numbered ? numbered[1] : name;
}

type Placed = {
  file: ExtractedFile;
  captureId: string;
  at: number;
  folder: string;
};

type Undo =
  | { kind: "files"; names: string[] }
  | { kind: "pad"; name: string; text: string };

const TAB_IDLE_MS = 2 * 60 * 1000;

function TabStrip({ label, children }: { label?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(Date.now());

  useEffect(() => {
    const current = ref.current;
    if (!current) return;
    const strip: HTMLDivElement = current;
    function onWheel(event: WheelEvent) {
      if (strip.scrollWidth <= strip.clientWidth + 1) return;
      const dominant = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!dominant) return;
      let delta = dominant;
      if (event.deltaMode === 1) delta *= 16;
      else if (event.deltaMode === 2) delta *= strip.clientWidth;
      event.preventDefault();
      strip.scrollLeft += delta;
      last.current = Date.now();
    }
    strip.addEventListener("wheel", onWheel, { passive: false });
    const timer = window.setInterval(() => {
      if (strip.scrollLeft <= 1) return;
      if (Date.now() - last.current >= TAB_IDLE_MS) strip.scrollLeft = 0;
    }, 1000);
    return () => {
      strip.removeEventListener("wheel", onWheel);
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div ref={ref} className="tabs" role="tablist" aria-label={label} onPointerDown={() => { last.current = Date.now(); }}>
      {children}
    </div>
  );
}

function TabChip({
  label,
  title,
  selected,
  kind,
  onOpen,
  onDouble,
  onArchive,
}: {
  label: string;
  title?: string;
  selected: boolean;
  kind?: "folder" | "pad";
  onOpen: () => void;
  onDouble?: (anchor: HTMLElement) => void;
  onArchive?: () => void;
}) {
  return (
    <div className={["tab-slot", kind ?? "", selected ? "on" : ""].filter(Boolean).join(" ")}>
      <button
        type="button"
        role="tab"
        className="tab"
        title={title}
        aria-selected={selected}
        onClick={onOpen}
        onDoubleClick={(event) => onDouble?.(event.currentTarget)}
      >
        {label}
      </button>
      {onArchive ? (
        <button type="button" className="tab-x" aria-label={`Archiver ${label}`} onClick={onArchive}>
          ×
        </button>
      ) : null}
    </div>
  );
}

export function FileStage({ captures, photos, captureId, onSelectCapture, onSaveFile, onToast, focusFile, canArchive = false, onArchive, onRestore }: Props) {
  const capture = captures.find((item) => item.id === captureId) ?? captures[0] ?? null;
  const files = capture?.files ?? EMPTY_FILES;
  const placed = useMemo(() => {
    const now = Date.now();
    const rows: Placed[] = [];
    for (const item of captures) {
      for (const file of item.files) {
        if (file.archivedAt) continue;
        const path = splitPath(file.filename);
        rows.push({
          file,
          captureId: item.id,
          at: fileStamp(file.updatedAt, item.createdAt),
          folder: normalizeFolder(path.folder),
        });
      }
    }
    rows.sort((a, b) => b.at - a.at);
    const seen = new Set<string>();
    const unique: Placed[] = [];
    for (const row of rows) {
      if (seen.has(row.file.filename)) continue;
      seen.add(row.file.filename);
      unique.push(row);
    }
    const open = unique.filter((row) => now - row.at < INSERT_WEEK_MS).sort((a, b) => b.at - a.at);
    const history = unique.filter((row) => now - row.at >= INSERT_WEEK_MS);
    return { open, history };
  }, [captures]);
  const folders = useMemo(() => {
    const latest = new Map<string, number>();
    for (const row of placed.open) {
      const prev = latest.get(row.folder) ?? 0;
      if (row.at > prev) latest.set(row.folder, row.at);
    }
    return [...latest.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [placed]);
  const showFolders = folders.some((item) => item !== "");
  const captureKey = capture?.id ?? "";
  const [seen, setSeen] = useState(captureKey);
  const [folder, setFolder] = useState<string | null>(null);
  const [tab, setTab] = useState(CAPTURE_TAB);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pads, setPads] = useState<string[]>([]);
  const [padText, setPadText] = useState<Record<string, string>>({});
  const [ocr, setOcr] = useState("");
  const [ocrWords, setOcrWords] = useState<OcrWord[]>([]);
  const [reading, setReading] = useState(false);
  const padRef = useRef<HTMLTextAreaElement>(null);

  if (seen !== captureKey) {
    const stillThere =
      tab === CAPTURE_TAB ||
      captures.some((item) => item.files.some((file) => file.filename === tab)) ||
      pads.includes(tab);
    setSeen(captureKey);
    if (!stillThere) {
      setFolder(null);
      setTab(CAPTURE_TAB);
    }
    setEditing(false);
    setMenu(false);
  }

  const activeFolder = folder !== null && folders.includes(folder) ? folder : (folders[0] ?? "");
  const savedNames = useMemo(() => new Set(captures.flatMap((item) => item.files.map((file) => file.filename))), [captures]);
  const openPads = pads.filter((name) => !savedNames.has(name));
  const visible = showFolders ? placed.open.filter((row) => row.folder === activeFolder) : placed.open;
  const historyHere = showFolders ? placed.history.filter((row) => row.folder === activeFolder) : placed.history;
  const located = visible.find((row) => row.file.filename === tab) ?? placed.history.find((row) => row.file.filename === tab) ?? null;
  const current = located?.file ?? null;
  const onCaptureTab = tab === CAPTURE_TAB;
  const onPad = isNotepad(tab) || openPads.includes(tab);
  const padValue = padText[tab] ?? current?.content ?? "";

  const latestPhoto = [...photos].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1) ?? null;

  useEffect(() => {
    setOcr("");
    setOcrWords([]);
  }, [latestPhoto?.id]);

  useEffect(() => {
    if (onPad) padRef.current?.focus();
  }, [tab, onPad]);

  const fileName = current?.filename ?? "";
  const fileContent = current?.content ?? "";
  const decodedContent = fileContent ? decodeCodeEntities(fileContent) : "";
  const [styled, setStyled] = useState<{ key: string; text: string; html: string } | null>(null);
  useEffect(() => {
    if (!fileContent) return;
    const key = `${fileName}\0${fileContent}`;
    let cancel = false;
    void presentCode(fileName, fileContent).then((result) => {
      if (!cancel) setStyled({ key, ...result });
    });
    return () => {
      cancel = true;
    };
  }, [fileName, fileContent]);
  const styledReady = styled?.key === `${fileName}\0${fileContent}`;
  const shown = styledReady && styled ? styled.text : decodedContent;
  const shownHtml = styledReady && styled ? styled.html : "";

  const [folderMenu, setFolderMenu] = useState<{ folder: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!folderMenu) return;
    function close(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".folder-menu")) return;
      setFolderMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setFolderMenu(null);
    }
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [folderMenu]);
  const undos = useRef<Undo[]>([]);
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;
  const toastRef = useRef(onToast);
  toastRef.current = onToast;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "z" || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const last = undos.current.pop();
      if (!last) return;
      event.preventDefault();
      if (last.kind === "pad") {
        setPads((list) => (list.includes(last.name) ? list : [...list, last.name]));
        setPadText((map) => ({ ...map, [last.name]: last.text }));
        setTab(last.name);
        toastRef.current("Onglet ramené");
        return;
      }
      const restore = restoreRef.current;
      if (!restore) {
        undos.current.push(last);
        return;
      }
      void restore(last.names)
        .then(() => {
          const back = splitPath(last.names[0] ?? "");
          setFolder(back.folder);
          if (last.names[0]) setTab(last.names[0]);
          toastRef.current("Ramené");
        })
        .catch(() => {
          undos.current.push(last);
          toastRef.current("Impossible de ramener.");
        });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const seenFocus = useRef(0);
  useEffect(() => {
    if (!focusFile || seenFocus.current === focusFile.nonce) return;
    const row =
      placed.open.find((item) => item.file.filename === focusFile.name) ??
      placed.history.find((item) => item.file.filename === focusFile.name);
    if (!row) return;
    seenFocus.current = focusFile.nonce;
    onSelectCapture(row.captureId);
    setFolder(row.folder);
    setTab(row.file.filename);
    setEditing(false);
    setMenu(false);
  }, [focusFile, placed, onSelectCapture]);

  async function archiveNames(names: string[], message: string) {
    if (!onArchive || !names.length) return false;
    try {
      await onArchive(names);
      undos.current.push({ kind: "files", names });
      if (names.includes(tab)) setTab(CAPTURE_TAB);
      onToast(message);
      return true;
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Archivage impossible.");
      return false;
    }
  }

  function openFolderMenu(folderName: string, anchor: HTMLElement) {
    const box = anchor.getBoundingClientRect();
    setFolderMenu({ folder: folderName, x: box.left, y: box.bottom + 4 });
  }

  async function downloadFolder(folderName: string) {
    const rows = [...placed.open, ...placed.history].filter((row) => row.folder === folderName);
    setFolderMenu(null);
    if (!rows.length) {
      onToast("Ce dossier est vide.");
      return;
    }
    const used = new Set<string>();
    const packed: { name: string; text: string }[] = [];
    for (const row of rows) {
      const { text } = await presentCode(row.file.filename, row.file.content);
      const base = splitPath(row.file.filename).name || "fichier.txt";
      let name = base;
      const dot = base.lastIndexOf(".");
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : "";
      let count = 2;
      while (used.has(name)) {
        name = `${stem}-${count}${ext}`;
        count += 1;
      }
      used.add(name);
      packed.push({ name, text });
    }
    const label = folderLabel(folderName).replace(/[<>:"/\\|?*]/g, "-");
    downloadBlob(`${label}.zip`, zipFolder(label, packed));
    onToast("Dossier téléchargé");
  }

  function filenamesIn(folderName: string) {
    const names = new Set<string>();
    for (const row of [...placed.open, ...placed.history]) {
      if (row.folder === folderName) names.add(row.file.filename);
    }
    return [...names];
  }

  function askArchiveFolder(folderName: string) {
    const names = filenamesIn(folderName);
    if (!names.length) return;
    const label = folderLabel(folderName);
    const count = names.length;
    if (!window.confirm(`Archiver le dossier ${label} et ${count} fichier${count > 1 ? "s" : ""} ? Ctrl+Z les ramène.`)) return;
    void archiveNames(names, "Dossier archivé").then((ok) => {
      if (ok && activeFolder === folderName) setFolder(null);
    });
  }

  function dropPad(name: string) {
    undos.current.push({ kind: "pad", name, text: padText[name] ?? "" });
    setPads((list) => list.filter((item) => item !== name));
    setPadText((map) => {
      const next = { ...map };
      delete next[name];
      return next;
    });
    if (tab === name) setTab(CAPTURE_TAB);
    onToast("Onglet archivé");
  }

  function chooseFolder(next: string) {
    setFolder(next);
    const first = placed.open.find((row) => row.folder === next);
    if (!first) return;
    onSelectCapture(first.captureId);
    setTab(first.file.filename);
    setEditing(false);
    setMenu(false);
  }

  function openPad() {
    const used = new Set([...files.map((file) => file.filename), ...pads]);
    let number = 1;
    while (used.has(`${number}.txt`)) number += 1;
    const name = `${number}.txt`;
    setPads((list) => [...list, name]);
    setPadText((map) => ({ ...map, [name]: "" }));
    setTab(name);
    setMenu(false);
    setEditing(false);
  }

  async function copyFile(file: ExtractedFile) {
    const { text } = await presentCode(file.filename, file.content);
    await copyText(text);
    onToast(`${tabLabel(file.filename)} copié`);
  }

  async function copyAllCode() {
    const source = capture?.files ?? [];
    if (!source.length) {
      onToast("Aucun code à copier.");
      return;
    }
    const parts = await Promise.all(
      source.map(async (file) => `// ${file.filename}\n${(await presentCode(file.filename, file.content)).text}`),
    );
    await copyText(parts.join("\n\n"));
    onToast("Tout le code est copié");
    setMenu(false);
  }

  async function readText() {
    if (!latestPhoto) {
      onToast("Aucune photo à lire.");
      return;
    }
    setReading(true);
    setOcr("");
    setOcrWords([]);
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("fra+eng");
      const image = await fetch(latestPhoto.url).then((res) => res.blob());
      const bitmap = await createImageBitmap(image);
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close();
      const result = await worker.recognize(image, {}, { text: true, blocks: true });
      await worker.terminate();
      const text = result.data.text.trim();
      setOcr(text || "Aucun texte lisible sur cette photo.");
      setOcrWords(text ? readOcrWords(result.data, width, height) : []);
    } catch {
      setOcr("");
      setOcrWords([]);
      onToast("La lecture du texte a échoué. Réessaie.");
    } finally {
      setReading(false);
    }
  }

  async function copySelection() {
    const selected = window.getSelection()?.toString().trim() ?? "";
    if (!selected) {
      onToast("Sélectionne une partie du texte.");
      return;
    }
    await copyText(selected);
    onToast("Sélection copiée");
  }

  async function savePad(name: string, content: string) {
    try {
      await onSaveFile({
        captureId: capture?.id ?? null,
        filename: name,
        content,
        archivePending: content.trim().length > 0,
      });
      setTab(name);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Enregistrement impossible.");
    }
  }

  async function saveEdit(event?: FormEvent) {
    event?.preventDefault();
    if (!current) return;
    try {
      await onSaveFile({ captureId: located?.captureId ?? capture?.id ?? null, filename: current.filename, content: draft });
      setEditing(false);
      setMenu(false);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Enregistrement impossible.");
    }
  }

  return (
    <section className="pane pane-files">
      <div className="pane-head">
        <h2>Fichiers</h2>
        <div className="head-actions">
        {captures.length > 1 ? (
          <select
            className="history"
            aria-label="Extractions précédentes"
            value={capture?.id ?? ""}
            onChange={(event) => onSelectCapture(event.target.value)}
          >
            {captures.map((item) => (
              <option key={item.id} value={item.id}>
                {formatWhen(item.createdAt)} · {item.files.length} fichier{item.files.length > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        ) : null}
        </div>
      </div>
      <TabStrip label="Dossiers">
        <button
          type="button"
          className={onCaptureTab ? "capture-link on" : "capture-link"}
          onClick={() => {
            setTab(CAPTURE_TAB);
            setMenu(false);
            setEditing(false);
          }}
        >
          Dernière capture
        </button>
        {showFolders
          ? folders.map((item) => (
              <TabChip
                key={item || "racine"}
                label={folderLabel(item)}
                selected={item === activeFolder}
                kind="folder"
                onOpen={() => chooseFolder(item)}
                onDouble={(anchor) => openFolderMenu(item, anchor)}
                onArchive={canArchive ? () => askArchiveFolder(item) : undefined}
              />
            ))
          : null}
      </TabStrip>
      <TabStrip label="Fichiers">
        {visible.map((row) => (
          <TabChip
            key={row.file.filename}
            label={tabLabel(row.file.filename)}
            title={tabLabel(row.file.filename)}
            selected={row.file.filename === tab}
            kind={isNotepad(row.file.filename) ? "pad" : undefined}
            onOpen={() => {
              onSelectCapture(row.captureId);
              setFolder(row.folder);
              setTab(row.file.filename);
              setEditing(false);
              setMenu(false);
            }}
            onArchive={canArchive ? () => void archiveNames([row.file.filename], `${tabLabel(row.file.filename)} archivé`) : undefined}
          />
        ))}
        {openPads.map((name) => (
          <TabChip
            key={name}
            label={tabLabel(name)}
            selected={name === tab}
            kind="pad"
            onOpen={() => {
              setTab(name);
              setEditing(false);
              setMenu(false);
            }}
            onArchive={canArchive ? () => dropPad(name) : undefined}
          />
        ))}
        <button type="button" className="tab plus" aria-label="Nouvel onglet" onClick={openPad}>
          +
        </button>
      </TabStrip>
      {historyHere.length ? (
        <details className="file-history">
          <summary>Historique · {historyHere.length}</summary>
          <p className="hint">Les onglets de plus de 7 jours.</p>
          <TabStrip>
            {historyHere.map((row) => (
              <TabChip
                key={row.file.filename}
                label={tabLabel(row.file.filename)}
                title={tabLabel(row.file.filename)}
                selected={row.file.filename === tab}
                onOpen={() => {
                  onSelectCapture(row.captureId);
                  setFolder(row.folder);
                  setTab(row.file.filename);
                  setEditing(false);
                  setMenu(false);
                }}
                onArchive={canArchive ? () => void archiveNames([row.file.filename], `${tabLabel(row.file.filename)} archivé`) : undefined}
              />
            ))}
          </TabStrip>
        </details>
      ) : null}
      {onCaptureTab ? (
        <div className="sheet capture">
          <div className="sheet-bar">
            <strong>Dernière capture</strong>
            {latestPhoto ? (
              <div className="sheet-actions">
                <button type="button" onClick={() => void readText()} disabled={reading}>
                  {reading ? "Lecture…" : "Lire le texte"}
                </button>
                <button type="button" onClick={() => void copyText(ocr).then(() => onToast("Texte copié"))} disabled={!ocr}>
                  Copier tout
                </button>
                <button type="button" onClick={() => void copySelection()} disabled={!ocr}>
                  Copier la sélection
                </button>
              </div>
            ) : null}
          </div>
          {latestPhoto ? (
            <div className="capture-shot">
              <div className="ocr-stage">
                <img key={latestPhoto.id} src={latestPhoto.url} alt="Dernière capture" draggable={false} />
                {ocrWords.length ? (
                  <div className="ocr-layer">
                    {ocrWords.map((word) => (
                      <span
                        key={word.key}
                        className="ocr-word"
                        style={{
                          left: `${word.x}%`,
                          top: `${word.y}%`,
                          width: `${word.w}%`,
                          height: `${word.h}%`,
                          ["--h" as string]: word.h,
                        }}
                      >
                        {word.text}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              {ocrWords.length ? <p className="hint">Sélectionne le texte directement sur la photo, puis copie-le.</p> : null}
            </div>
          ) : (
            <div className="capture-hold">
              <span>Connecte un appareil pour continuer</span>
            </div>
          )}
          {ocr && !ocrWords.length ? <pre className="ocr-text">{ocr}</pre> : null}
        </div>
      ) : onPad ? (
        <form
          className="sheet scratch"
          onSubmit={(event) => {
            event.preventDefault();
            void savePad(tab, padValue);
          }}
        >
          <div className="sheet-bar">
            <strong>{tabLabel(tab)}</strong>
            <div className="sheet-actions">
              <button className="lime" type="submit">Enregistrer</button>
              <button
                type="button"
                onClick={() => void copyText(padValue).then(() => onToast("Texte copié"))}
                disabled={!padValue}
              >
                Copier
              </button>
              <div className="dot-menu">
                <button type="button" aria-label="Plus d’actions" aria-expanded={menu} onClick={() => setMenu((open) => !open)}>
                  ···
                </button>
                {menu ? (
                  <div className="dot-pop" role="menu">
                    <button type="button" onClick={() => void copyAllCode()}>
                      Copier tout le code
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <textarea
            ref={padRef}
            className="scratch-pad"
            value={padValue}
            placeholder="Colle le texte"
            onChange={(event) => setPadText((map) => ({ ...map, [tab]: event.target.value }))}
          />
        </form>
      ) : current && editing ? (
        <form className="sheet add-file" onSubmit={(event) => void saveEdit(event)}>
          <p className="hint">{tabLabel(current.filename)}</p>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} required />
          <div className="row">
            <button className="lime" type="submit">Enregistrer</button>
            <button className="ghost" type="button" onClick={() => setEditing(false)}>Annuler</button>
          </div>
        </form>
      ) : current ? (
        <div className="sheet">
          <div className="sheet-bar">
            <strong>{tabLabel(current.filename)}</strong>
            <span>
              {current.language} · {shown.split("\n").length} lignes
            </span>
            <div className="sheet-actions">
              <button type="button" onClick={() => void copyFile(current)}>
                Copier tout
              </button>
              <button
                type="button"
                onClick={() => {
                  void presentCode(current.filename, current.content).then(({ text }) => {
                    downloadText(splitPath(current.filename).name, text);
                  });
                }}
              >
                Télécharger
              </button>
              <div className="dot-menu">
                <button type="button" aria-label="Modifier le fichier" aria-expanded={menu} onClick={() => setMenu((open) => !open)}>
                  ···
                </button>
                {menu ? (
                  <div className="dot-pop" role="menu">
                    <button
                      type="button"
                      onClick={() => {
                        void presentCode(current.filename, current.content).then(({ text }) => {
                          setDraft(text);
                          setEditing(true);
                          setMenu(false);
                        });
                      }}
                    >
                      Modifier
                    </button>
                    <button type="button" onClick={() => void copyAllCode()}>
                      Copier tout le code
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <p className="hint">Clic droit sur le code pour tout copier.</p>
          <div
            className="sheet-scroll"
            onContextMenu={(event) => {
              event.preventDefault();
              void copyFile(current);
            }}
          >
            <div className="code-row">
              <div className="gutter" aria-hidden="true">
                {shown.split("\n").map((_, index) => (
                  <span key={index}>{index + 1}</span>
                ))}
              </div>
              {shownHtml ? (
                <pre className="code" dangerouslySetInnerHTML={{ __html: shownHtml }} />
              ) : (
                <pre className="code">{shown}</pre>
              )}
            </div>
          </div>
          {capture?.notes ? (
            <details className="notes">
              <summary>Ce que l’agent a vu</summary>
              <p>{capture.notes}</p>
            </details>
          ) : null}
        </div>
      ) : null}
      {folderMenu ? (
        <div className="folder-menu" style={{ left: folderMenu.x, top: folderMenu.y }} role="menu">
          <button type="button" onClick={() => void downloadFolder(folderMenu.folder)}>
            Télécharger
          </button>
        </div>
      ) : null}
    </section>
  );
}
