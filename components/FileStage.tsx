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

function BarIcon({ name }: { name: "copy" | "download" | "menu" }) {
  const props = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  if (name === "copy") {
    return (
      <svg {...props}>
        <rect x="8" y="8" width="12" height="12" rx="1.5" />
        <path d="M4 16V5a1 1 0 0 1 1-1h11" />
      </svg>
    );
  }
  if (name === "download") {
    return (
      <svg {...props}>
        <path d="M12 4v10M8 10l4 4 4-4M5 19h14" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <circle cx="12" cy="6" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
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

  const onCaptureTab = tab === CAPTURE_TAB;
  const activeFolder = onCaptureTab
    ? null
    : folder !== null && folders.includes(folder)
      ? folder
      : (folders[0] ?? "");
  const savedNames = useMemo(() => new Set(captures.flatMap((item) => item.files.map((file) => file.filename))), [captures]);
  const openPads = pads.filter((name) => !savedNames.has(name));
  const visible = showFolders ? placed.open.filter((row) => row.folder === activeFolder) : placed.open;
  const historyHere = showFolders ? placed.history.filter((row) => row.folder === activeFolder) : placed.history;
  const located = visible.find((row) => row.file.filename === tab) ?? placed.history.find((row) => row.file.filename === tab) ?? null;
  const current = located?.file ?? null;
  const onPad = isNotepad(tab) || openPads.includes(tab);
  const padValue = padText[tab] ?? current?.content ?? "";

  const latestPhoto = [...photos].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1) ?? null;

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
      if (names.includes(tab)) {
        setTab(CAPTURE_TAB);
        setFolder(null);
      }
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
    if (tab === name) {
      setTab(CAPTURE_TAB);
      setFolder(null);
    }
    onToast("Onglet archivé");
  }

  function chooseFolder(next: string) {
    setFolder(next);
    setEditing(false);
    setMenu(false);
    const first = placed.open.find((row) => row.folder === next);
    if (!first) {
      if (tab === CAPTURE_TAB) setTab("");
      return;
    }
    onSelectCapture(first.captureId);
    setTab(first.file.filename);
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
            setFolder(null);
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
                selected={!onCaptureTab && item === activeFolder}
                kind="folder"
                onOpen={() => chooseFolder(item)}
                onDouble={(anchor) => openFolderMenu(item, anchor)}
                onArchive={canArchive ? () => askArchiveFolder(item) : undefined}
              />
            ))
          : null}
      </TabStrip>
      {onCaptureTab ? null : <TabStrip label="Fichiers">
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
      </TabStrip>}
      {!onCaptureTab && historyHere.length ? (
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
          {latestPhoto ? (
            <div className="capture-shot">
              <div className="ocr-stage">
                <img key={latestPhoto.id} src={latestPhoto.url} alt="Dernière capture" draggable={false} />
              </div>
            </div>
          ) : (
            <div className="capture-hold">
              <span>Connecte un appareil pour continuer</span>
            </div>
          )}
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
                <button type="button" className="icon-act" aria-label="Plus d’actions" aria-expanded={menu} onClick={() => setMenu((open) => !open)}>
                  <BarIcon name="menu" />
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
      ) : current ? (
        <div className={editing ? "sheet sheet-edit" : "sheet"}>
          <div className="sheet-bar">
            <strong>{tabLabel(current.filename)}</strong>
            <div className="sheet-actions">
              {editing ? null : (
                <>
                  <button type="button" className="icon-act" aria-label="Copier tout" onClick={() => void copyFile(current)}>
                    <BarIcon name="copy" />
                  </button>
                  <button
                    type="button"
                    className="icon-act"
                    aria-label="Télécharger"
                    onClick={() => {
                      void presentCode(current.filename, current.content).then(({ text }) => {
                        downloadText(splitPath(current.filename).name, text);
                      });
                    }}
                  >
                    <BarIcon name="download" />
                  </button>
                  <div className="dot-menu">
                    <button type="button" className="icon-act" aria-label="Modifier le fichier" aria-expanded={menu} onClick={() => setMenu((open) => !open)}>
                      <BarIcon name="menu" />
                    </button>
                    {menu ? (
                      <div className="dot-pop" role="menu">
                        {canArchive ? (
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
                        ) : null}
                        <button type="button" onClick={() => void copyAllCode()}>
                          Copier tout le code
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
          <div
            className="sheet-scroll"
            onContextMenu={(event) => {
              if (editing) return;
              event.preventDefault();
              void copyFile(current);
            }}
          >
            {editing ? (
              <textarea
                className="code-edit"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
                autoFocus
              />
            ) : (
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
            )}
            {editing ? (
              <div className="edit-float">
                <button type="button" className="edit-pill edit-pill-cancel" onClick={() => setEditing(false)}>
                  Annuler
                </button>
                <button type="button" className="edit-pill edit-pill-save" onClick={() => void saveEdit()}>
                  Enregistrer
                </button>
              </div>
            ) : null}
          </div>
          {!editing && capture?.notes ? (
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
