export type ExtractedFile = {
  filename: string;
  language: string;
  content: string;
  updatedAt?: string;
  archivedAt?: string;
  authorId?: string;
};

export type PhotoDTO = {
  id: string;
  createdAt: string;
  captureId: string | null;
  url: string;
};

export type CaptureDTO = {
  id: string;
  createdAt: string;
  notes: string;
  photoCount: number;
  files: ExtractedFile[];
};

export type GroupDTO = {
  id: string;
  name: string;
  code: string;
  brief: string;
  intervalSec: number;
  createdAt: string;
  copiedIds: string[];
  owner: boolean;
  lookOnly: boolean;
};

export type MemberDTO = {
  id: string;
  name: string;
  online: boolean;
  banned: boolean;
  lookOnly: boolean;
  owner: boolean;
};

export type CameraDTO = {
  deviceId: string;
  seenAt: string;
  phone: boolean;
  camera: boolean;
  running: boolean;
  intervalSec: number;
  label: string;
  ownerName?: string;
  ack?: number;
  nextAt?: number;
};

export type GroupPayload = {
  group: GroupDTO;
  photos: PhotoDTO[];
  captures: CaptureDTO[];
  cameras: CameraDTO[];
  members: MemberDTO[];
};

export type GroupSummary = GroupDTO & {
  photoCount: number;
  pendingCount: number;
  fileCount: number;
  memberCount: number;
  creatorName: string;
  lastCaptureAt: string | null;
  owner: boolean;
  access: "ok" | "banned" | "kicked";
  kickUntil: number;
};

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  hasOpenAIKey: boolean;
  model: string;
};
