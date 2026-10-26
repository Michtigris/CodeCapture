import { randomInt, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { DEFAULT_BRIEF, DEFAULT_INTERVAL, DEFAULT_MODEL, LEGACY_BRIEFS } from "./constants";
import { chooseHistoryDrops } from "./history";
import { cleanInsertName, fileStamp, INSERT_WEEK_MS } from "./insert";
import { r2Configured, r2Del, r2Get, r2Put, R2Error } from "./r2";
import type { ExtractedFile } from "./types";
import { mimeFor, type ImageExt } from "./sniff";

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  salt: string;
  openaiKey: string | null;
  model: string;
  createdAt: string;
};

export type SessionRecord = {
  tokenHash: string;
  userId: string;
  expiresAt: string;
};

export type GroupRecord = {
  id: string;
  userId: string;
  name: string;
  code: string;
  memberIds: string[];
  brief: string;
  intervalSec: number;
  createdAt: string;
  copiedIds: string[];
};

export type PhotoRecord = {
  id: string;
  groupId: string;
  createdAt: string;
  captureId: string | null;
  archivedAt?: string;
  ext: ImageExt;
};

export type CaptureRecord = {
  id: string;
  groupId: string;
  createdAt: string;
  notes: string;
  photoIds: string[];
  files: ExtractedFile[];
};

export type ResetRecord = {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

export type CameraRecord = {
  groupId: string;
  deviceId: string;
  seenAt: string;
  phone: boolean;
  camera: boolean;
  running: boolean;
  intervalSec: number;
  label: string;
  command?: CameraCommand | null;
  ack?: number;
};

export type CameraCommand = {
  id: number;
  deviceId: string;
  action: "start" | "stop" | "shoot" | "interval";
  intervalSec?: number;
};

type DB = {
  users: UserRecord[];
  sessions: SessionRecord[];
  groups: GroupRecord[];
  photos: PhotoRecord[];
  captures: CaptureRecord[];
  resets: ResetRecord[];
  cameras: CameraRecord[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const PHOTO_DIR = path.join(DATA_DIR, "photos");
const DB_PATH = path.join(DATA_DIR, "db.json");
const BLOB_DB = "codecapture/db.json";

function storageMode(): "r2" | "file" {
  if (r2Configured()) return "r2";
  if (process.env["VERCEL"]) {
    throw new Error("Le stockage Cloudflare n'est pas configuré.");
  }
  return "file";
}

function empty(): DB {
  return { users: [], sessions: [], groups: [], photos: [], captures: [], resets: [], cameras: [] };
}

function normalize(data: DB): DB {
  data.users ??= [];
  data.sessions ??= [];
  data.groups ??= [];
  data.photos ??= [];
  data.captures ??= [];
  data.resets ??= [];
  data.cameras ??= [];
  return data;
}

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function nextCode(used: Set<string>): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    let code = "";
    for (let index = 0; index < 5; index++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
  }
  throw new Error("Impossible de créer un code de groupe.");
}

function repairGroups(db: DB): boolean {
  let changed = false;
  const used = new Set<string>();
  for (const group of db.groups) {
    if (!Array.isArray(group.memberIds)) {
      group.memberIds = [];
      changed = true;
    }
    if (!group.memberIds.includes(group.userId)) {
      group.memberIds.push(group.userId);
      changed = true;
    }
    if (LEGACY_BRIEFS.includes(group.brief)) {
      group.brief = DEFAULT_BRIEF;
      changed = true;
    }
    if (!Array.isArray(group.copiedIds)) {
      group.copiedIds = [];
      changed = true;
    }
    const code = String(group.code || "").toUpperCase();
    if (!/^[A-Z]{5}$/.test(code) || used.has(code)) {
      group.code = nextCode(used);
      changed = true;
    } else if (group.code !== code) {
      group.code = code;
      changed = true;
    }
    used.add(group.code);
  }
  return changed;
}

export function isMember(group: GroupRecord | null | undefined, userId: string): group is GroupRecord {
  if (!group) return false;
  return group.userId === userId || group.memberIds?.includes(userId) === true;
}

async function readReady(): Promise<DB> {
  if (storageMode() === "file") {
    const db = read();
    if (repairGroups(db)) write(db);
    return db;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const loaded = await loadBlob();
    if (!repairGroups(loaded.db)) return loaded.db;
    try {
      await saveBlob(loaded.db, loaded.etag);
      return loaded.db;
    } catch (error) {
      if (!isConflict(error) || attempt === 3) throw error;
    }
  }
  throw new Error("Le stockage en ligne est occupé. Réessaie.");
}

function ensure() {
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(empty()));
  }
}

function read(): DB {
  ensure();
  const raw = fs.readFileSync(DB_PATH, "utf8");
  let data: DB;
  try {
    data = JSON.parse(raw) as DB;
  } catch {
    throw new Error("La base locale est illisible. Vérifie le fichier data/db.json.");
  }
  return normalize(data);
}

function write(db: DB) {
  ensure();
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.copyFileSync(tmp, DB_PATH);
  fs.rmSync(tmp, { force: true });
}

let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function readThrough<T>(fn: (db: DB) => T): Promise<T> {
  return enqueue(async () => fn(await readReady()));
}

function update<T>(fn: (db: DB) => T): Promise<T> {
  return enqueue(async () => {
    if (storageMode() === "file") {
      const db = read();
      repairGroups(db);
      const result = fn(db);
      write(db);
      return result;
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const loaded = await loadBlob();
        repairGroups(loaded.db);
        const result = fn(loaded.db);
        await saveBlob(loaded.db, loaded.etag);
        return result;
      } catch (error) {
        if (!isConflict(error) || attempt === 5) throw error;
      }
    }
    throw new Error("Le stockage en ligne est occupé. Réessaie.");
  });
}

function photoFile(photo: PhotoRecord): string {
  return path.join(PHOTO_DIR, `${photo.id}.${photo.ext}`);
}

function photoBlobPath(photo: PhotoRecord): string {
  return `codecapture/photos/${photo.id}.${photo.ext}`;
}

export async function readPhotoBytes(photo: PhotoRecord): Promise<Buffer | null> {
  if (storageMode() === "file") {
    const filePath = photoFile(photo);
    if (!fs.existsSync(filePath)) return null;
    return fs.promises.readFile(filePath);
  }
  const loaded = await r2Get(photoBlobPath(photo));
  if (!loaded) return null;
  return Buffer.from(loaded.body);
}

async function savePhotoBytes(photo: PhotoRecord, bytes: Buffer) {
  if (storageMode() === "file") {
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    fs.writeFileSync(photoFile(photo), bytes);
    return;
  }
  await r2Put(photoBlobPath(photo), bytes, mimeFor(photo.ext));
}

async function removePhotoBytes(photo: PhotoRecord) {
  if (storageMode() === "file") {
    fs.rmSync(photoFile(photo), { force: true });
    return;
  }
  try {
    await r2Del(photoBlobPath(photo));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function loadDb(): Promise<{ db: DB; etag: string | null }> {
  if (storageMode() === "file") return { db: read(), etag: null };
  return loadBlob();
}

let blobMemo: { raw: string; etag: string | null; at: number } | null = null;

async function loadBlob(): Promise<{ db: DB; etag: string | null }> {
  const now = Date.now();
  if (blobMemo && now - blobMemo.at < 8000) {
    return { db: normalize(JSON.parse(blobMemo.raw) as DB), etag: blobMemo.etag };
  }
  const loaded = await r2Get(BLOB_DB);
  if (!loaded) return { db: empty(), etag: null };
  const raw = new TextDecoder().decode(loaded.body);
  let data: DB;
  try {
    data = JSON.parse(raw) as DB;
  } catch {
    throw new Error("La base en ligne est illisible.");
  }
  blobMemo = { raw, etag: loaded.etag, at: now };
  return { db: normalize(data), etag: loaded.etag };
}

async function saveBlob(db: DB, etag: string | null) {
  blobMemo = null;
  await r2Put(BLOB_DB, JSON.stringify(db), "application/json", etag);
}

function isMissing(error: unknown): boolean {
  if (error instanceof R2Error && error.status === 404) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("not found") || message.includes("does not exist") || message.includes("404");
}

function isConflict(error: unknown): boolean {
  if (error instanceof R2Error && (error.status === 412 || error.status === 409)) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("occupé") || message.includes("precondition") || message.includes("conflict");
}

export function findUserByEmail(email: string): Promise<UserRecord | null> {
  return readThrough((db) => db.users.find((user) => user.email === email) ?? null);
}

export function findUserById(id: string): Promise<UserRecord | null> {
  return readThrough((db) => db.users.find((user) => user.id === id) ?? null);
}

export function createUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  salt: string;
}): Promise<UserRecord> {
  return update((db) => {
    if (db.users.some((user) => user.email === input.email)) {
      throw new Error("Un compte existe déjà avec cet email.");
    }
    const user: UserRecord = {
      id: randomUUID(),
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      salt: input.salt,
      openaiKey: null,
      model: DEFAULT_MODEL,
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    return user;
  });
}

export function updateUser(
  id: string,
  patch: Partial<Pick<UserRecord, "name" | "openaiKey" | "model">>,
): Promise<UserRecord | null> {
  return update((db) => {
    const user = db.users.find((item) => item.id === id);
    if (!user) return null;
    if (patch.name !== undefined) user.name = patch.name;
    if (patch.openaiKey !== undefined) user.openaiKey = patch.openaiKey;
    if (patch.model !== undefined) user.model = patch.model;
    return user;
  });
}

export function createSession(userId: string, tokenHash: string): Promise<void> {
  return update((db) => {
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    db.sessions = db.sessions.filter((session) => Date.parse(session.expiresAt) > Date.now());
    db.sessions.push({ tokenHash, userId, expiresAt: expires });
  });
}

export function findUserBySession(tokenHash: string): Promise<UserRecord | null> {
  return readThrough((db) => {
    const session = db.sessions.find((item) => item.tokenHash === tokenHash);
    if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
    return db.users.find((user) => user.id === session.userId) ?? null;
  });
}

export function readSession(tokenHash: string): Promise<SessionRecord | null> {
  return readThrough((db) => {
    const session = db.sessions.find((item) => item.tokenHash === tokenHash);
    if (!session) return null;
    if (Date.parse(session.expiresAt) <= Date.now()) return null;
    return session;
  });
}

export function deleteSession(tokenHash: string): Promise<void> {
  return update((db) => {
    db.sessions = db.sessions.filter((session) => session.tokenHash !== tokenHash);
  });
}

export function issueReset(userId: string, tokenHash: string): Promise<"ok" | "soon"> {
  return update((db) => {
    const now = Date.now();
    db.resets = db.resets.filter((item) => Date.parse(item.expiresAt) > now);
    const recent = db.resets.find((item) => item.userId === userId && now - Date.parse(item.createdAt) < 60_000);
    if (recent) return "soon";
    db.resets = db.resets.filter((item) => item.userId !== userId);
    db.resets.push({
      tokenHash,
      userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    });
    return "ok";
  });
}

export function dropReset(tokenHash: string): Promise<void> {
  return update((db) => {
    db.resets = db.resets.filter((item) => item.tokenHash !== tokenHash);
  });
}

export function resetPassword(tokenHash: string, passwordHash: string, salt: string): Promise<string | null> {
  return update((db) => {
    const now = Date.now();
    const reset = db.resets.find((item) => item.tokenHash === tokenHash && Date.parse(item.expiresAt) > now);
    if (!reset) return null;
    const user = db.users.find((item) => item.id === reset.userId);
    if (!user) return null;
    user.passwordHash = passwordHash;
    user.salt = salt;
    db.sessions = db.sessions.filter((item) => item.userId !== user.id);
    db.resets = db.resets.filter((item) => item.userId !== user.id);
    return user.id;
  });
}

type LiveDevice = {
  id: string;
  seenAt: string;
  phone: boolean;
  camera?: boolean;
  running?: boolean;
  intervalSec?: number;
  label?: string;
  ack?: number;
};

type LiveState = {
  devices: LiveDevice[];
  command: CameraCommand | null;
  watch: string | null;
  seq: number;
};

function livePath(groupId: string): string {
  return `codecapture/live/${groupId}.json`;
}

function controlPath(groupId: string): string {
  return `codecapture/livecmd/${groupId}.json`;
}

async function readControl(groupId: string): Promise<Pick<LiveState, "command" | "watch" | "seq">> {
  try {
    const loaded = await r2Get(controlPath(groupId));
    if (!loaded) return { command: null, watch: null, seq: 0 };
    const data = JSON.parse(new TextDecoder().decode(loaded.body)) as Partial<LiveState>;
    return { command: data.command ?? null, watch: data.watch ?? null, seq: data.seq ?? 0 };
  } catch (error) {
    if (isMissing(error)) return { command: null, watch: null, seq: 0 };
    throw error;
  }
}

async function writeControl(groupId: string, control: Pick<LiveState, "command" | "watch" | "seq">) {
  await r2Put(controlPath(groupId), JSON.stringify(control), "application/json");
}

function freshCameras(groupId: string, devices: LiveDevice[], maxAge: number): CameraRecord[] {
  const now = Date.now();
  return devices
    .filter((item) => now - Date.parse(item.seenAt) < maxAge)
    .map((item) => ({
      groupId,
      deviceId: item.id,
      seenAt: item.seenAt,
      phone: item.phone !== false,
      camera: item.camera === true,
      running: item.running === true,
      intervalSec: item.intervalSec || 0,
      label: item.label || "",
      ack: item.ack,
    }));
}

function emptyLive(): LiveState {
  return { devices: [], command: null, watch: null, seq: 0 };
}

async function readLive(groupId: string): Promise<LiveState> {
  try {
    const loaded = await r2Get(livePath(groupId));
    if (!loaded) return emptyLive();
    const data = JSON.parse(new TextDecoder().decode(loaded.body)) as Partial<LiveState>;
    return {
      devices: Array.isArray(data.devices) ? data.devices : [],
      command: data.command ?? null,
      watch: data.watch ?? null,
      seq: data.seq ?? 0,
    };
  } catch (error) {
    if (isMissing(error)) return emptyLive();
    throw error;
  }
}

async function writeLive(groupId: string, state: LiveState) {
  await r2Put(livePath(groupId), JSON.stringify(state), "application/json");
}

function phoneLabel(devices: LiveDevice[], deviceId: string, givenName?: string): string {
  const first = givenName?.trim().split(/\s+/)[0]?.slice(0, 24) ?? "";
  if (first) {
    const base = `Téléphone ${first}`;
    const taken = devices.some((item) => item.id !== deviceId && item.label === base);
    return taken ? `${base} 2` : base;
  }
  const known = devices.filter((item) => item.phone && item.label && item.id !== deviceId);
  return `Téléphone ${known.length + 1}`;
}

export async function touchCamera(
  groupId: string,
  deviceId: string,
  phone: boolean,
  status?: { camera?: boolean; running?: boolean; intervalSec?: number; givenName?: string; ack?: number },
): Promise<{ command: CameraCommand | null; watch: boolean }> {
  if (storageMode() === "file") {
    let command: CameraCommand | null = null;
    await update((db) => {
      const now = Date.now();
      const queued = db.cameras.find((item) => item.groupId === groupId && item.deviceId === deviceId)?.command ?? null;
      db.cameras = db.cameras.filter((item) => now - Date.parse(item.seenAt) < 60_000);
      let current = db.cameras.find((item) => item.groupId === groupId && item.deviceId === deviceId);
      if (current) {
        current.seenAt = new Date(now).toISOString();
        current.phone = phone;
        if (status?.camera !== undefined) current.camera = status.camera;
        if (status?.running !== undefined) current.running = status.running;
        if (status?.intervalSec) current.intervalSec = status.intervalSec;
        if (status?.ack) current.ack = status.ack;
        if (phone && (status?.givenName || !current.label)) {
          current.label = phoneLabel(
            db.cameras
              .filter((item) => item.groupId === groupId)
              .map((item) => ({ id: item.deviceId, seenAt: item.seenAt, phone: item.phone, label: item.label })),
            deviceId,
            status?.givenName,
          );
        }
      } else {
        current = {
          groupId,
          deviceId,
          seenAt: new Date(now).toISOString(),
          phone,
          camera: status?.camera === true,
          running: status?.running === true,
          intervalSec: status?.intervalSec || 0,
          label: phone ? phoneLabel([], deviceId, status?.givenName) : "",
        };
        db.cameras.push(current);
      }
      current.command = null;
      if (queued?.deviceId === deviceId) {
        command = queued;
        if (queued.action === "interval" && queued.intervalSec) current.intervalSec = queued.intervalSec;
        if (queued.action === "start") current.running = true;
        if (queued.action === "stop") current.running = false;
      }
    });
    return { command, watch: false };
  }
  const now = Date.now();
  const state = await readLive(groupId);
  state.devices = state.devices.filter((item) => now - Date.parse(item.seenAt) < 60_000);
  const seenAt = new Date(now).toISOString();
  let current = state.devices.find((item) => item.id === deviceId);
  const previousSeen = current?.seenAt ?? "";
  const nextCamera = status?.camera !== undefined ? status.camera : current?.camera;
  const nextRunning = status?.running !== undefined ? status.running : current?.running;
  const nextInterval = status?.intervalSec || current?.intervalSec || 0;
  const nextLabel =
    phone && status?.givenName
      ? phoneLabel(state.devices, deviceId, status.givenName)
      : current?.label || (phone ? phoneLabel(state.devices, deviceId) : "");
  const changed =
    !current ||
    current.phone !== phone ||
    current.camera !== nextCamera ||
    current.running !== nextRunning ||
    (current.intervalSec || 0) !== nextInterval ||
    (current.label || "") !== nextLabel ||
    (status?.ack ? current.ack !== status.ack : false) ||
    now - Date.parse(previousSeen) > 20_000;
  if (!current) {
    current = { id: deviceId, seenAt, phone, label: nextLabel };
    state.devices.push(current);
  }
  current.seenAt = seenAt;
  current.phone = phone;
  current.camera = nextCamera;
  current.running = nextRunning;
  current.intervalSec = nextInterval;
  current.label = nextLabel;
  if (status?.ack) current.ack = status.ack;
  if (changed) await writeLive(groupId, { ...state, command: null, watch: null, seq: state.seq });
  const control = await readControl(groupId);
  let command: CameraCommand | null = null;
  if (control.command?.deviceId === deviceId) {
    command = control.command;
    control.command = null;
    await writeControl(groupId, control);
    if (command.action === "interval" && command.intervalSec) current.intervalSec = command.intervalSec;
    if (command.action === "start") current.running = true;
    if (command.action === "stop") current.running = false;
    state.devices = state.devices.map((item) => (item.id === current?.id ? current : item));
    await writeLive(groupId, { ...state, command: null, watch: null, seq: state.seq });
  }
  return { command, watch: false };
}

export async function pushCameraCommand(groupId: string, command: Omit<CameraCommand, "id">): Promise<number> {
  const id = Date.now();
  if (storageMode() === "file") {
    await update((db) => {
      let target = db.cameras.find((item) => item.groupId === groupId && item.deviceId === command.deviceId);
      if (!target) {
        target = {
          groupId,
          deviceId: command.deviceId,
          seenAt: new Date().toISOString(),
          phone: true,
          camera: false,
          running: false,
          intervalSec: command.intervalSec || 0,
          label: "Téléphone",
        };
        db.cameras.push(target);
      }
      target.command = { ...command, id };
      if (command.action === "interval" && command.intervalSec) target.intervalSec = command.intervalSec;
    });
    return id;
  }
  const control = await readControl(groupId);
  control.seq += 1;
  control.command = { ...command, id: control.seq };
  await writeControl(groupId, control);
  if (command.action === "interval" && command.intervalSec) {
    const state = await readLive(groupId);
    const target = state.devices.find((item) => item.id === command.deviceId);
    if (target) {
      target.intervalSec = command.intervalSec;
      await writeLive(groupId, { ...state, command: null, watch: null, seq: state.seq });
    }
  }
  return control.seq;
}

export async function listLiveCameras(groupId: string): Promise<CameraRecord[]> {
  if (storageMode() === "file") {
    return readThrough((db) => freshCameras(groupId, db.cameras.filter((item) => item.groupId === groupId).map((item) => ({
      id: item.deviceId,
      seenAt: item.seenAt,
      phone: item.phone !== false,
      camera: item.camera === true,
      running: item.running === true,
      intervalSec: item.intervalSec || 0,
      label: item.label || "",
      ack: item.ack,
    })), 45_000));
  }
  return freshCameras(groupId, (await readLive(groupId)).devices, 45_000);
}

export function loadGroupBundle(groupId: string): Promise<{
  group: GroupRecord;
  photos: PhotoRecord[];
  captures: CaptureRecord[];
} | null> {
  return readThrough((db) => {
    const group = db.groups.find((item) => item.id === groupId);
    if (!group) return null;
    return {
      group,
      photos: db.photos.filter((photo) => photo.groupId === groupId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      captures: db.captures
        .filter((capture) => capture.groupId === groupId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  });
}

export function listGroups(userId: string): Promise<GroupRecord[]> {
  return readThrough((db) =>
    db.groups
      .filter((group) => isMember(group, userId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  );
}

export function getGroup(id: string): Promise<GroupRecord | null> {
  return readThrough((db) => db.groups.find((group) => group.id === id) ?? null);
}

export function getGroupByCode(code: string): Promise<GroupRecord | null> {
  const wanted = code.toUpperCase();
  return readThrough((db) => db.groups.find((group) => group.code === wanted) ?? null);
}

export function joinGroup(userId: string, code: string): Promise<GroupRecord | null> {
  const wanted = code.trim().toUpperCase();
  if (!/^[A-Z]{5}$/.test(wanted)) return Promise.resolve(null);
  return update((db) => {
    const group = db.groups.find((item) => item.code === wanted);
    if (!group) return null;
    if (!group.memberIds.includes(userId)) group.memberIds.push(userId);
    return group;
  });
}

export function createGroup(userId: string, name: string): Promise<GroupRecord> {
  return update((db) => {
    const used = new Set(db.groups.map((group) => group.code));
    const group: GroupRecord = {
      id: randomUUID(),
      userId,
      name,
      code: nextCode(used),
      memberIds: [userId],
      brief: DEFAULT_BRIEF,
      intervalSec: DEFAULT_INTERVAL,
      createdAt: new Date().toISOString(),
      copiedIds: [],
    };
    db.groups.push(group);
    return group;
  });
}

export function updateGroup(
  id: string,
  patch: Partial<Pick<GroupRecord, "name" | "brief" | "intervalSec">>,
): Promise<GroupRecord | null> {
  return update((db) => {
    const group = db.groups.find((item) => item.id === id);
    if (!group) return null;
    if (patch.name !== undefined) group.name = patch.name;
    if (patch.brief !== undefined) group.brief = patch.brief;
    if (patch.intervalSec !== undefined) group.intervalSec = patch.intervalSec;
    return group;
  });
}

export async function deleteGroup(id: string): Promise<void> {
  const photos = await listPhotos(id);
  await update((db) => {
    db.photos = db.photos.filter((photo) => photo.groupId !== id);
    db.captures = db.captures.filter((capture) => capture.groupId !== id);
    db.cameras = db.cameras.filter((camera) => camera.groupId !== id);
    db.groups = db.groups.filter((group) => group.id !== id);
  });
  await Promise.all(photos.map((photo) => removePhotoBytes(photo)));
  if (storageMode() === "r2") {
    await r2Del(livePath(id)).catch((error) => {
      if (!isMissing(error)) throw error;
    });
    await r2Del(controlPath(id)).catch((error) => {
      if (!isMissing(error)) throw error;
    });
  }
}

export function listPhotos(groupId: string): Promise<PhotoRecord[]> {
  return readThrough((db) =>
    db.photos
      .filter((photo) => photo.groupId === groupId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  );
}

export function getPhoto(id: string): Promise<PhotoRecord | null> {
  return readThrough((db) => db.photos.find((photo) => photo.id === id) ?? null);
}

function diskFree(): number | null {
  if (storageMode() !== "file") return null;
  try {
    const stat = fs.statfsSync(DATA_DIR);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}

function fileBytes(photo: PhotoRecord): number {
  if (storageMode() !== "file") return 0;
  try {
    return fs.statSync(photoFile(photo)).size;
  } catch {
    return 0;
  }
}

let prunedAt = 0;

export async function pruneHistoryPhotos(force = false): Promise<void> {
  if (!force && Date.now() - prunedAt < 60_000) return;
  const victims = await update((db) => {
    const drop = new Set(
      chooseHistoryDrops(
        db.photos.map((photo) => ({
          id: photo.id,
          createdAt: photo.createdAt,
          archivedAt: photo.archivedAt,
          captureId: photo.captureId,
          bytes: fileBytes(photo),
        })),
        Date.now(),
        diskFree(),
      ),
    );
    if (!drop.size) return [] as PhotoRecord[];
    const gone = db.photos.filter((photo) => drop.has(photo.id));
    db.photos = db.photos.filter((photo) => !drop.has(photo.id));
    for (const capture of db.captures) {
      if (capture.photoIds.some((id) => drop.has(id))) {
        capture.photoIds = capture.photoIds.filter((id) => !drop.has(id));
      }
    }
    for (const group of db.groups) {
      if (group.copiedIds.some((id) => drop.has(id))) {
        group.copiedIds = group.copiedIds.filter((id) => !drop.has(id));
      }
    }
    return gone;
  });
  prunedAt = Date.now();
  await Promise.all(victims.map((photo) => removePhotoBytes(photo)));
}

function archivePhotos(db: DB, groupId: string, captureId: string, ids: Set<string>) {
  if (!ids.size) return;
  const capture = db.captures.find((item) => item.id === captureId && item.groupId === groupId);
  const now = new Date().toISOString();
  for (const photo of db.photos) {
    if (photo.groupId !== groupId || photo.captureId || !ids.has(photo.id)) continue;
    photo.captureId = captureId;
    photo.archivedAt = now;
    if (capture && !capture.photoIds.includes(photo.id)) capture.photoIds.push(photo.id);
  }
}

export function rememberCopiedPhotos(groupId: string, ids: string[]): Promise<string[]> {
  const wanted = [...new Set(ids)].slice(0, 24);
  return update((db) => {
    const group = db.groups.find((item) => item.id === groupId);
    if (!group) return [];
    const pending = new Set(
      db.photos.filter((photo) => photo.groupId === groupId && !photo.captureId).map((photo) => photo.id),
    );
    group.copiedIds = wanted.filter((id) => pending.has(id));
    return group.copiedIds;
  });
}

export async function addPhoto(groupId: string, ext: ImageExt, bytes: Buffer): Promise<PhotoRecord> {
  await pruneHistoryPhotos(true);
  const photo: PhotoRecord = {
    id: randomUUID(),
    groupId,
    createdAt: new Date().toISOString(),
    captureId: null,
    ext,
  };
  await savePhotoBytes(photo, bytes);
  try {
    await update((db) => {
      db.photos.push(photo);
    });
  } catch (error) {
    await removePhotoBytes(photo);
    throw error;
  }
  return photo;
}

export async function deletePhoto(id: string): Promise<boolean> {
  const existing = await getPhoto(id);
  const removed = await update((db) => {
    const photo = db.photos.find((item) => item.id === id);
    if (!photo) return false;
    db.photos = db.photos.filter((item) => item.id !== id);
    for (const group of db.groups) {
      if (group.copiedIds.includes(id)) group.copiedIds = group.copiedIds.filter((item) => item !== id);
    }
    return true;
  });
  if (removed && existing) await removePhotoBytes(existing);
  return removed;
}

export function listCaptures(groupId: string): Promise<CaptureRecord[]> {
  return readThrough((db) =>
    db.captures
      .filter((capture) => capture.groupId === groupId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
}

function fileLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    php: "php",
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    css: "css",
    scss: "scss",
    html: "html",
    json: "json",
    sql: "sql",
  };
  return map[ext] || "text";
}

export function saveManualFile(input: {
  groupId: string;
  captureId: string | null;
  filename: string;
  content: string;
  archivePending?: boolean;
}): Promise<CaptureRecord> {
  return update((db) => {
    const filename = input.filename.trim().replace(/\\/g, "/").replace(/\.\./g, "").replace(/^\/+/, "");
    if (!filename || filename.length > 180) throw new Error("Nom de fichier invalide.");
    let capture: CaptureRecord | undefined;
    if (input.captureId) {
      capture = db.captures.find((item) => item.id === input.captureId && item.groupId === input.groupId);
    } else {
      capture = db.captures
        .filter((item) => item.groupId === input.groupId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    }
    if (!capture) {
      capture = {
        id: randomUUID(),
        groupId: input.groupId,
        createdAt: new Date().toISOString(),
        notes: "",
        photoIds: [],
        files: [],
      };
      db.captures.push(capture);
    }
    const content = input.content.replace(/\0/g, "").slice(0, 200_000);
    const now = new Date().toISOString();
    const existing = capture.files.find((file) => file.filename === filename);
    if (existing) {
      existing.content = content;
      existing.language = fileLanguage(filename);
      existing.updatedAt = now;
    } else {
      capture.files.push({ filename, language: fileLanguage(filename), content, updatedAt: now });
    }
    if (input.archivePending && content.trim()) {
      const pending = db.photos.filter((photo) => photo.groupId === input.groupId && !photo.captureId);
      archivePhotos(db, input.groupId, capture.id, new Set(pending.map((photo) => photo.id)));
    }
    return capture;
  });
}

export function saveInsertedFiles(
  groupId: string,
  incoming: { filename: string; content: string }[],
): Promise<{ captureId: string; filename: string }> {
  return update((db) => {
    const now = new Date().toISOString();
    const nowMs = Date.now();
    let focusCapture = "";
    let focusName = "";
    for (const item of incoming) {
      const filename = cleanInsertName(item.filename);
      if (!filename) throw new Error("Nom de fichier invalide.");
      const content = item.content.replace(/\0/g, "").slice(0, 200_000);
      const matches = db.captures
        .filter((capture) => capture.groupId === groupId)
        .flatMap((capture) =>
          capture.files
            .filter((file) => file.filename === filename)
            .map((file) => ({ capture, file })),
        )
        .sort((a, b) => fileStamp(b.file.updatedAt, b.capture.createdAt) - fileStamp(a.file.updatedAt, a.capture.createdAt));
      const open = matches.find((match) => nowMs - fileStamp(match.file.updatedAt, match.capture.createdAt) < INSERT_WEEK_MS);
      const target = open ?? matches[0];
      if (target) {
        target.file.content = content;
        target.file.language = fileLanguage(filename);
        target.file.updatedAt = now;
        focusCapture = target.capture.id;
        focusName = filename;
        continue;
      }
      let capture = db.captures
        .filter((item) => item.groupId === groupId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!capture) {
        capture = {
          id: randomUUID(),
          groupId,
          createdAt: now,
          notes: "",
          photoIds: [],
          files: [],
        };
        db.captures.push(capture);
      }
      capture.files.push({ filename, language: fileLanguage(filename), content, updatedAt: now });
      focusCapture = capture.id;
      focusName = filename;
    }
    if (!focusCapture || !focusName) throw new Error("Rien à insérer.");
    const group = db.groups.find((item) => item.id === groupId);
    if (group?.copiedIds.length) {
      archivePhotos(db, groupId, focusCapture, new Set(group.copiedIds));
      group.copiedIds = [];
    }
    return { captureId: focusCapture, filename: focusName };
  });
}

export function addCapture(input: {
  groupId: string;
  notes: string;
  photoIds: string[];
  files: ExtractedFile[];
}): Promise<CaptureRecord> {
  return update((db) => {
    const capture: CaptureRecord = {
      id: randomUUID(),
      groupId: input.groupId,
      createdAt: new Date().toISOString(),
      notes: input.notes,
      photoIds: input.photoIds,
      files: input.files,
    };
    db.captures.push(capture);
    archivePhotos(db, input.groupId, capture.id, new Set(input.photoIds));
    return capture;
  });
}

export function countForGroups(userId: string): Promise<{
  photos: PhotoRecord[];
  captures: CaptureRecord[];
  groups: GroupRecord[];
}> {
  return readThrough((db) => {
    const groups = db.groups
      .filter((group) => isMember(group, userId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const ids = new Set(groups.map((group) => group.id));
    return {
      groups,
      photos: db.photos.filter((photo) => ids.has(photo.groupId)),
      captures: db.captures.filter((capture) => ids.has(capture.groupId)),
    };
  });
}
