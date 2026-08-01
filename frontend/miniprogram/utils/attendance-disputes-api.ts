import { request } from "./api";
import { MediaAttachment } from "./models";

export type AttendanceIssue =
  | "companionAbsent"
  | "customerAbsent"
  | "lateArrival"
  | "technicalFailure"
  | "earlyExit"
  | "serviceMismatch"
  | "safetyBoundary"
  | "other";

export type AttendanceDispute = {
  id: string;
  order: { id: string; status: string; scheduledAt: string; durationMinutes: number; serviceTitle: string | null };
  issue: AttendanceIssue;
  status: "evidenceCollection" | "counterpartyResponse" | "review" | "decided" | "appealed" | "final";
  openedByRole: "customer" | "companion";
  viewerRole: "customer" | "companion";
  policyVersion: string;
  timezone: string;
  deadlines: {
    evidenceDueAt: string;
    counterpartyResponseDueAt: string;
    appealDeadlineAt: string | null;
    appealResponseDueAt: string | null;
  };
  statements: Array<{
    id: string;
    participantRole: "customer" | "companion";
    kind: string;
    statement: string;
    evidenceAttachments: MediaAttachment[];
    createdAt: string;
  }>;
  attendanceSummary: {
    providerEvidenceAvailable: boolean;
    providerRoomEvents: number;
    auxiliaryClientEvents: number;
    decisionConstraint: string;
    customer: AttendanceParticipantSummary;
    companion: AttendanceParticipantSummary;
  };
  decision: { outcome: "noRefund" | "fullRefund"; reason: string; decidedAt: string | null } | null;
  appeal: { appealedByRole: "customer" | "companion"; appealedAt: string; independentlyAssigned: boolean } | null;
  finalDecision: { outcome: "noRefund" | "fullRefund"; reason: string; finalizedAt: string | null } | null;
  refund: { id: string; status: string; amountCents: number; providerRefundId: string | null; successConfirmedAt: string | null } | null;
  recording: "notRecordedByDefault";
};

type AttendanceParticipantSummary = {
  trustedProviderEvents: number;
  firstJoinedAt: string | null;
  lastLeftAt: string | null;
  joinCount: number;
  leaveCount: number;
  reconnectCount: number;
  audioStartedCount: number;
  audioStoppedCount: number;
  auxiliaryClientEvents: number;
};

export type AttendancePolicy = {
  version: string;
  timezone: string;
  waitMinutes: number;
  caseWindowDays: number;
  evidenceCollectionHours: number;
  counterpartyResponseHours: number;
  appealHours: number;
  insufficientEvidence: string;
  recording: string;
  settlement: string;
  refund: string;
};

export const attendanceDisputesApi = {
  policy: () => request<AttendancePolicy>("/attendance-disputes/policy", { authenticated: false }),
  mine: (options: { page?: number; pageSize?: number; status?: string } = {}) => {
    const query = [
      options.page ? `page=${options.page}` : "",
      options.pageSize ? `pageSize=${options.pageSize}` : "",
      options.status ? `status=${encodeURIComponent(options.status)}` : ""
    ].filter(Boolean).join("&");
    return request<{
      items: AttendanceDispute[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/attendance-disputes/mine${query ? `?${query}` : ""}`);
  },
  mineByOrder: (orderId: string) => request<{ item: AttendanceDispute | null }>(
    `/orders/${encodeURIComponent(orderId)}/attendance-disputes/me`
  ),
  get: (id: string) => request<AttendanceDispute>(`/attendance-disputes/${encodeURIComponent(id)}`),
  reportClientEvent: (orderId: string, eventType: "join" | "leave" | "reconnect" | "heartbeat", clientEventId: string) => request(
    `/orders/${encodeURIComponent(orderId)}/attendance-events`,
    { method: "POST", data: { eventType, clientEventId, claimedAt: new Date().toISOString() } }
  ),
  create: (orderId: string, issue: AttendanceIssue, statement?: string) => request<AttendanceDispute>(
    `/orders/${encodeURIComponent(orderId)}/attendance-disputes`,
    { method: "POST", data: { issue, ...(statement?.trim() ? { statement: statement.trim() } : {}) } }
  ),
  completeEvidence: (id: string) => request<AttendanceDispute>(
    `/attendance-disputes/${encodeURIComponent(id)}/evidence-completion`,
    { method: "POST" }
  ),
  statement: (id: string, statement: string, evidenceAssetIds: string[] = []) => request<AttendanceDispute>(
    `/attendance-disputes/${encodeURIComponent(id)}/statements`,
    { method: "POST", data: { statement: statement.trim(), ...(evidenceAssetIds.length ? { evidenceAssetIds } : {}) } }
  ),
  appeal: (id: string, statement: string, evidenceAssetIds: string[] = []) => request<AttendanceDispute>(
    `/attendance-disputes/${encodeURIComponent(id)}/appeals`,
    { method: "POST", data: { statement: statement.trim(), ...(evidenceAssetIds.length ? { evidenceAssetIds } : {}) } }
  )
};
