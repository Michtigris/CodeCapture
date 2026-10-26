"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { folderLabel, splitPath } from "@/lib/paths";
import type { CaptureDTO, ExtractedFile, PhotoDTO } from "@/lib/types";
import { copyText, downloadText } from "./copy";
import { formatWhen } from "./format";

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
};

function isNotepad(filename: string) {
  return /^\d+\.txt$/i.test(splitPath(filename).name);
}

function tabLabel(filename: string) {
  const name = splitPath(filename).name;
  const numbered = name.match(/^(\d+)\.txt$/i);
  return numbered ? numbered[1] : name;
}

export function FileStage({ captures, photos, captureId, onSelectCapture, onSaveFile, onToast }: Props) {
  const capture = captures.find((item) => item.id === captureId) ?? captures[0] ?? null;
  const files = capture?.files ?? EMPTY_FILES;
  const parsed = useMemo(() => files.map((file) => ({ ...file, ...splitPath(file.filename) })), [files]);
  const folders = useMemo(() => [...new Set(parsed.map((file) => file.folder))], [parsed]);
  const showFolders = folders.some((folder) => folder !== "");
  const captureKey = capture?.id ?? "";
  const [seen, setSeen] = useState(captureKey);
  const [folder, setFolder] = useState(() => parsed[0]?.folder ?? "");
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
    const stillThere = tab === CAPTURE_TAB || files.some((file) => file.filename === tab) || pads.includes(tab);
    setSeen(captureKey);
    setFolder(parsed[0]?.folder ?? "");
    if (!stillThere) setTab(CAPTURE_TAB);
    setEditing(false);
    setMenu(false);
  }

  const savedNames = useMemo(() => new Set(files.map((file) => file.filename)), [files]);
  const openPads = pads.filter((name) => !savedNames.has(name));
  const visible = parsed.filter((file) => !showFolders || file.folder === folder || isNotepad(file.filename));
  const current = files.find((file) => file.filename === tab) ?? null;
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

  function chooseFolder(next: string) {
    setFolder(next);
    const first = parsed.find((file) => file.folder === next);
    if (first) setTab(first.filename);
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
    await copyText(file.content);
    onToast(`${tabLabel(file.filename)} copié`);
  }

  async function copyAllCode() {
    const source = capture?.files ?? [];
    if (!source.length) {
      onToast("Aucun code à copier.");
      return;
    }
    const text = source.map((file) => `// ${file.filename}\n${file.content}`).join("\n\n");
    await copyText(text);
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
      await onSaveFile({ captureId: capture?.id ?? null, filename: current.filename, content: draft });
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
      {showFolders && !onCaptureTab && !onPad ? (
        <div className="tabs" role="tablist" aria-label="Dossiers">
          {folders.map((item) => (
            <button
              key={item || "racine"}
              type="button"
              className={item === folder ? "tab folder on" : "tab folder"}
              onClick={() => chooseFolder(item)}
            >
              {folderLabel(item)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="tabs" role="tablist" aria-label="Fichiers">
        <button
          type="button"
          role="tab"
          className={onCaptureTab ? "tab on capture" : "tab"}
          onClick={() => {
            setTab(CAPTURE_TAB);
            setMenu(false);
            setEditing(false);
          }}
        >
          Dernière capture
        </button>
        {visible.map((file) => (
          <button
            key={file.filename}
            type="button"
            role="tab"
            aria-selected={file.filename === tab}
            className={file.filename === tab ? (isNotepad(file.filename) ? "tab on pad" : "tab on") : "tab"}
            onClick={() => {
              setFolder(file.folder);
              setTab(file.filename);
              setEditing(false);
              setMenu(false);
            }}
          >
            {tabLabel(file.filename)}
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
      {onCaptureTab ? (
        <div className="sheet capture">
          <div className="sheet-bar">
            <strong>Dernière capture</strong>
            <div className="sheet-actions">
              <button type="button" onClick={() => void readText()} disabled={reading || !latestPhoto}>
                {reading ? "Lecture…" : "Lire le texte"}
              </button>
              <button type="button" onClick={() => void copyText(ocr).then(() => onToast("Texte copié"))} disabled={!ocr}>
                Copier tout
              </button>
              <button type="button" onClick={() => void copySelection()} disabled={!ocr}>
                Copier la sélection
              </button>
            </div>
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
          <p className="hint">{current.filename}</p>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} required />
          <div className="row">
            <button className="lime" type="submit">Enregistrer</button>
            <button className="ghost" type="button" onClick={() => setEditing(false)}>Annuler</button>
          </div>
        </form>
      ) : current ? (
        <div className="sheet">
          <div className="sheet-bar">
            <strong>{current.filename}</strong>
            <span>
              {current.language} · {current.content.split("\n").length} lignes
            </span>
            <div className="sheet-actions">
              <button type="button" onClick={() => void copyFile(current)}>
                Copier tout
              </button>
              <button type="button" onClick={() => downloadText(splitPath(current.filename).name, current.content)}>
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
                        setDraft(current.content);
                        setEditing(true);
                        setMenu(false);
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
                {current.content.split("\n").map((_, index) => (
                  <span key={index}>{index + 1}</span>
                ))}
              </div>
              <pre className="code">{current.content}</pre>
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
