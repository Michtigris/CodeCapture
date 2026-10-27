import { PHOTO_BATCH } from "./constants";
import { decodeCodeEntities } from "./insert";
import type { ExtractedFile } from "./types";

const SYSTEM = `Tu es l'agent CodeCapture. On te donne des photos prises à intervalle régulier devant un écran, une feuille ou un tableau. Ton seul travail : reconstituer les fichiers de code visibles, prêts à copier-coller.

Règles :
- Repère les noms de fichiers (onglets d'éditeur, barre de titre, chemin, en-tête).
- Si le chemin contient des dossiers, garde-les dans filename (exemple : src/chat.php).
- Plusieurs photos du même fichier : fusionne-les en une seule version complète, dans l'ordre de lecture (haut du fichier, puis la suite).
- Recopie ce qui est lisible tel quel. N'embellis pas une ligne clairement visible.
- N'écris jamais [illisible]. Si un morceau est coupé, flou ou absent, mets le code le plus probable pour que le fichier s'exécute. S'il manque le début et qu'une fonction est appelée sans être définie, ajoute <?php et crée cette fonction. Si une photo suivante montre le vrai texte, remplace ce que tu avais deviné.
- Le champ content est le fichier brut, sans balises markdown, sans backticks et sans entités HTML. Un espace s'écrit espace, jamais &#x20; ni &nbsp;.
- Si aucun code n'est lisible, renvoie files vide et explique pourquoi dans notes.
- Réponds uniquement avec un objet JSON.

Exemple :
{"files":[{"filename":"animal.php","language":"php","content":"<?php\\nclass Animal {\\n}\\n"},{"filename":"chat.php","language":"php","content":"<?php\\nclass Chat extends Animal {\\n}\\n"}],"notes":"Deux classes PHP vues dans l'éditeur."}`;

type PhotoInput = {
  createdAt: string;
  bytes: Buffer;
  mime: string;
};

type ChatContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "high" } };

export async function extractCode(options: {
  apiKey: string;
  model: string;
  brief: string;
  photos: PhotoInput[];
}): Promise<{ files: ExtractedFile[]; notes: string }> {
  const batches = chunk(options.photos, PHOTO_BATCH);
  let files: ExtractedFile[] = [];
  const notes: string[] = [];

  for (let index = 0; index < batches.length; index++) {
    const result = await complete({
      apiKey: options.apiKey,
      model: options.model,
      content: buildContent({
        brief: options.brief,
        photos: batches[index],
        prior: files,
        index,
        total: batches.length,
      }),
    });
    files = mergeFiles(files, result.files);
    if (result.notes) notes.push(result.notes);
  }

  return { files, notes: notes.join("\n\n").slice(0, 4000) };
}

function buildContent(input: {
  brief: string;
  photos: PhotoInput[];
  prior: ExtractedFile[];
  index: number;
  total: number;
}): ChatContent[] {
  const parts: ChatContent[] = [];
  const intro = [
    input.brief.trim(),
    input.total > 1 ? `Série ${input.index + 1} sur ${input.total}.` : "",
    "Lis les photos dans l'ordre chronologique et renvoie le JSON des fichiers.",
    priorText(input.prior),
  ]
    .filter(Boolean)
    .join("\n\n");
  parts.push({ type: "text", text: intro });

  input.photos.forEach((photo, photoIndex) => {
    const when = new Date(photo.createdAt).toLocaleString("fr-FR");
    parts.push({
      type: "text",
      text: `Photo ${photoIndex + 1}, prise le ${when}.`,
    });
    parts.push({
      type: "image_url",
      image_url: {
        url: `data:${photo.mime};base64,${photo.bytes.toString("base64")}`,
        detail: "high",
      },
    });
  });
  return parts;
}

function priorText(files: ExtractedFile[]): string {
  if (!files.length) return "";
  let body = "";
  for (const file of files) {
    const chunk = `FICHIER ${file.filename}\n${file.content}\n\n`;
    if (body.length + chunk.length > 60000) {
      body += "[autres fichiers omis pour la longueur]\n";
      break;
    }
    body += chunk;
  }
  return `Fichiers déjà reconstruits. Si une nouvelle photo continue l'un d'eux, renvoie son contenu COMPLET, pas seulement le nouveau morceau.\n\n${body}`;
}

async function complete(input: {
  apiKey: string;
  model: string;
  content: ChatContent[];
}): Promise<{ files: ExtractedFile[]; notes: string }> {
  const tokenField = input.model.startsWith("gpt-4.1") ? "max_completion_tokens" : "max_tokens";
  const payload: Record<string, unknown> = {
    model: input.model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: input.content },
    ],
  };
  payload[tokenField] = 16384;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(err?.error?.message || `OpenAI a répondu ${response.status}.`);
  }

  const data = (await response.json()) as {
    choices?: { finish_reason?: string; message?: { content?: string } }[];
  };
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new Error("La réponse a été coupée. Envoie moins de photos à la fois.");
  }
  const raw = choice?.message?.content;
  if (!raw) throw new Error("ChatGPT n'a rien renvoyé.");
  try {
    return parseAgentJson(raw);
  } catch (error) {
    console.error("CodeCapture: réponse illisible", raw.slice(0, 600));
    throw error;
  }
}

export function parseAgentJson(raw: string): { files: ExtractedFile[]; notes: string } {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("La réponse de ChatGPT n'était pas lisible. Réessaie.");
  }
  if (!data || typeof data !== "object") {
    throw new Error("La réponse de ChatGPT n'était pas lisible. Réessaie.");
  }
  const record = data as Record<string, unknown>;
  const notes = typeof record.notes === "string" ? record.notes.trim() : "";
  const list = coerceFileList(record.files);
  const files: ExtractedFile[] = [];
  for (const item of list) {
    const file = sanitizeFile(item);
    if (file) files.push(file);
  }
  return { files: files.slice(0, 40), notes };
}

function coerceFileList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([filename, content]) => {
      if (typeof content === "string") return { filename, content };
      if (content && typeof content === "object") return { filename, ...(content as object) };
      return { filename, content: String(content ?? "") };
    });
  }
  return [];
}

function sanitizeFile(raw: unknown): ExtractedFile | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  let filename = String(record.filename || record.name || record.path || "").trim();
  filename = filename.replace(/\\/g, "/").replace(/\.\./g, "").replace(/^\.?\//, "").replace(/^\/+/, "");
  if (!filename || filename.length > 180) return null;
  const rawContent = record.content ?? record.code ?? "";
  let content = typeof rawContent === "string" ? rawContent : String(rawContent);
  content = content.replace(/\0/g, "").replace(/\r\n/g, "\n").replace(/^```[a-zA-Z0-9]*\n/, "").replace(/\n```$/, "");
  content = decodeCodeEntities(content);
  if (!content.trim()) return null;
  if (content.length > 200000) content = content.slice(0, 200000);
  const language = String(record.language || languageFromName(filename)).slice(0, 40);
  return { filename, language, content };
}

function languageFromName(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    php: "php",
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    css: "css",
    html: "html",
    json: "json",
    sql: "sql",
    java: "java",
    cs: "csharp",
    go: "go",
    rb: "ruby",
    rs: "rust",
    md: "markdown",
  };
  return map[ext] || "text";
}

function mergeFiles(prev: ExtractedFile[], next: ExtractedFile[]): ExtractedFile[] {
  const map = new Map(prev.map((file) => [file.filename, file]));
  for (const file of next) map.set(file.filename, file);
  return [...map.values()];
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
