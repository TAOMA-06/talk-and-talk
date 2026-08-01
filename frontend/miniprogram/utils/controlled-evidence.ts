import {
  api,
  ControlledEvidenceAsset,
  MediaUploadReservation,
  readLocalFile,
  uploadAuthorizedMedia
} from "./api";
import { sha256Hex } from "./sha256";

export type ControlledEvidenceDraft = {
  assetId: string;
  kind: "image" | "audio";
  status: ControlledEvidenceAsset["status"];
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  localPath?: string;
  statusText: string;
};

export type LocalEvidenceFile = {
  kind: "image" | "audio";
  path: string;
  mimeType: string;
  durationMs?: number;
};

type ReserveEvidence = (input: {
  kind: "image" | "audio";
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  durationMs?: number;
}) => Promise<{ asset: ControlledEvidenceAsset; upload: MediaUploadReservation["upload"] }>;

const STATUS_TEXT: Record<ControlledEvidenceAsset["status"], string> = {
  reserved: "等待上传",
  uploaded: "等待审核",
  scanning: "安全审核中",
  approved: "可随陈述提交",
  reviewRequired: "未通过自动审核，请更换文件",
  blocked: "文件不符合证据安全要求",
  failed: "处理失败，请重新选择",
  expired: "文件已过期，请重新选择"
};

export function controlledEvidenceDraft(
  asset: ControlledEvidenceAsset,
  localPath?: string
): ControlledEvidenceDraft {
  return {
    assetId: asset.id,
    kind: asset.kind,
    status: asset.status,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    durationMs: asset.durationMs ?? null,
    ...(localPath ? { localPath } : {}),
    statusText: STATUS_TEXT[asset.status]
  };
}

export function loadControlledEvidenceDrafts(storageKey: string): ControlledEvidenceDraft[] {
  const value = wx.getStorageSync(storageKey);
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item.assetId === "string")
    .slice(0, 3) as ControlledEvidenceDraft[];
}

export function saveControlledEvidenceDrafts(storageKey: string, drafts: ControlledEvidenceDraft[]) {
  if (!drafts.length) {
    wx.removeStorageSync(storageKey);
    return;
  }
  wx.setStorageSync(storageKey, drafts.slice(0, 3));
}

export async function refreshControlledEvidenceDrafts(
  drafts: ControlledEvidenceDraft[]
): Promise<ControlledEvidenceDraft[]> {
  const refreshed = await Promise.all(drafts.map(async (draft) => {
    try {
      const result = await api.caseEvidenceUploadStatus(draft.assetId);
      return controlledEvidenceDraft(result.asset, draft.localPath);
    } catch {
      return { ...draft, status: "failed" as const, statusText: STATUS_TEXT.failed };
    }
  }));
  return refreshed;
}

export function approvedControlledEvidenceIds(drafts: ControlledEvidenceDraft[]): string[] {
  return drafts.filter((item) => item.status === "approved").map((item) => item.assetId);
}

export function chooseEvidenceImage(): Promise<LocalEvidenceFile | null> {
  return new Promise((resolve) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (result: any) => {
        const file = result.tempFiles?.[0];
        resolve(file?.tempFilePath ? {
          kind: "image",
          path: file.tempFilePath,
          mimeType: imageMimeType(file.tempFilePath)
        } : null);
      },
      fail: () => resolve(null)
    });
  });
}

export function chooseEvidenceAudio(): Promise<LocalEvidenceFile | null> {
  return new Promise((resolve) => {
    if (!wx.chooseMessageFile) {
      wx.showToast({ title: "当前微信版本不支持选择音频文件", icon: "none" });
      resolve(null);
      return;
    }
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["mp3", "m4a", "aac", "wav", "amr"],
      success: async (result: any) => {
        const file = result.tempFiles?.[0];
        if (!file?.path) return resolve(null);
        const durationMs = await audioDurationMs(file.path);
        if (!durationMs || durationMs > 60_000) {
          wx.showToast({ title: "音频需为 60 秒以内", icon: "none" });
          resolve(null);
          return;
        }
        resolve({
          kind: "audio",
          path: file.path,
          mimeType: audioMimeType(file.path),
          durationMs
        });
      },
      fail: () => resolve(null)
    });
  });
}

export async function uploadControlledEvidence(
  file: LocalEvidenceFile,
  reserve: ReserveEvidence,
  onUpdate?: (draft: ControlledEvidenceDraft) => void
): Promise<ControlledEvidenceDraft> {
  const bytes = await readLocalFile(file.path);
  const reservation = await reserve({
    kind: file.kind,
    mimeType: file.mimeType,
    sizeBytes: bytes.byteLength,
    sha256: sha256Hex(bytes),
    ...(file.durationMs ? { durationMs: file.durationMs } : {})
  });
  let draft = controlledEvidenceDraft(reservation.asset, file.path);
  onUpdate?.(draft);
  await uploadAuthorizedMedia(reservation.upload, bytes);
  // Completion is idempotent server-side, so a lost response can retry safely.
  let completion;
  try {
    completion = await api.completeCaseEvidenceUpload(reservation.asset.id);
  } catch {
    completion = await api.completeCaseEvidenceUpload(reservation.asset.id);
  }
  draft = controlledEvidenceDraft(completion.asset, file.path);
  onUpdate?.(draft);
  return pollControlledEvidence(draft, onUpdate);
}

export async function pollControlledEvidence(
  initial: ControlledEvidenceDraft,
  onUpdate?: (draft: ControlledEvidenceDraft) => void,
  attempts = 20
): Promise<ControlledEvidenceDraft> {
  let draft = initial;
  for (let attempt = 0; attempt < attempts && ["reserved", "uploaded", "scanning"].includes(draft.status); attempt += 1) {
    await delay(750);
    const result = await api.caseEvidenceUploadStatus(draft.assetId);
    draft = controlledEvidenceDraft(result.asset, draft.localPath);
    onUpdate?.(draft);
  }
  return draft;
}

function imageMimeType(path: string): string {
  const value = path.toLowerCase();
  if (value.endsWith(".png")) return "image/png";
  if (value.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function audioMimeType(path: string): string {
  const value = path.toLowerCase();
  if (value.endsWith(".m4a") || value.endsWith(".mp4")) return "audio/mp4";
  if (value.endsWith(".aac")) return "audio/aac";
  if (value.endsWith(".wav")) return "audio/wav";
  if (value.endsWith(".amr")) return "audio/amr";
  return "audio/mpeg";
}

function audioDurationMs(path: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = wx.createInnerAudioContext();
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      audio.destroy?.();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 5_000);
    audio.onCanplay(() => {
      setTimeout(() => {
        clearTimeout(timer);
        const seconds = Number(audio.duration);
        finish(Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : null);
      }, 250);
    });
    audio.onError(() => {
      clearTimeout(timer);
      finish(null);
    });
    audio.src = path;
  });
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
