"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { decodeCodeEntities, fileStamp, INSERT_WEEK_MS } from "@/lib/insert";
import { folderLabel, splitPath } from "@/lib/paths";
import type { CaptureDTO, ExtractedFile, PhotoDTO } from "@/lib/types";
import { copyText, downloadText } from "./copy";
import { formatWhen } from "./format";
import { presentCode } from "./presentCode";

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

export function FileStage({ captures, photos, captureId, onSelectCapture, onSaveFile, onToast, focusFile }: Props) {
  const capture = captures.find((item) => item.id === captureId) ?? captures[0] ?? null;
  const files = capture?.files ?? EMPTY_FILES;
  const placed = useMemo(() => {
    const now = Date.now();
    const rows: Placed[] = [];
    for (const item of captures) {
      for (const file of item.files) {
        rows.push({
          file,
          captureId: item.id,
          at: fileStamp(file.updatedAt, item.createdAt),
          ...splitPath(file.filename),
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
      {showFolders ? (
        <div className="tabs" role="tablist" aria-label="Dossiers">
          {folders.map((item) => (
            <button
              key={item || "racine"}
              type="button"
              className={item === activeFolder ? "tab folder on" : "tab folder"}
              onClick={() => chooseFolder(item)}
            >
              {folderLabel(item)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="tabs" role="tablist" aria-label="Fichiers">
        {visible.map((row) => (
          <button
            key={row.file.filename}
            type="button"
            role="tab"
            title={row.file.filename}
            aria-selected={row.file.filename === tab}
            className={row.file.filename === tab ? (isNotepad(row.file.filename) ? "tab on pad" : "tab on") : "tab"}
            onClick={() => {
              onSelectCapture(row.captureId);
              setFolder(row.folder);
              setTab(row.file.filename);
              setEditing(false);
              setMenu(false);
            }}
          >
            {tabLabel(row.file.filename)}
          </button>
        ))}
        {openPads.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            className={name === tab ? "tab on pad" : "tab"}
            onClick={() => {
              setTab(name);
              setEditing(false);
              setMenu(false);
            }}
          >
            {tabLabel(name)}
          </button>
        ))}
        <button type="button" className="tab plus" aria-label="Nouvel onglet" onClick={openPad}>
          +
        </button>
      </div>
      {historyHere.length ? (
        <details className="file-history">
          <summary>Historique · {historyHere.length}</summary>
          <p className="hint">Les onglets de plus de 7 jours.</p>
          <div className="tabs">
            {historyHere.map((row) => (
              <button
                key={row.file.filename}
                type="button"
                title={row.file.filename}
                className={row.file.filename === tab ? "tab on" : "tab"}
                onClick={() => {
                  onSelectCapture(row.captureId);
                  setFolder(row.folder);
                  setTab(row.file.filename);
                  setEditing(false);
                  setMenu(false);
                }}
              >
                {tabLabel(row.file.filename)}
              </button>
            ))}
          </div>
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
    </section>
  );
}
