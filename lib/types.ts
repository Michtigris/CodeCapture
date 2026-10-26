export type ExtractedFile = {
  filename: string;
  language: string;
  content: string;
  updatedAt?: string;
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
};

export type CameraDTO = {
  deviceId: string;
  seenAt: string;
  phone: boolean;
  camera: boolean;
  running: boolean;
  intervalSec: number;
  label: string;
  ack?: number;
};

export type GroupPayload = {
  group: GroupDTO;
  photos: PhotoDTO[];
  captures: CaptureDTO[];
  cameras: CameraDTO[];
};

export type GroupSummary = GroupDTO & {
  photoCount: number;
  pendingCount: number;
  fileCount: number;
  lastCaptureAt: string | null;
  owner: boolean;
};

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  hasOpenAIKey: boolean;
  model: string;
};
