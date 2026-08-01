import { request } from "./api";

export type CompanionApplicationInput = {
  role: string;
  bio: string;
  pricePerHalfHour: number;
  tags: string[];
  availableTimes: string[];
  languages: string[];
  specialties: string[];
  cityDistrict: string;
};

export type CompanionProfileUpdate = {
  role?: string;
  bio?: string;
  tags?: string[];
  availableTimes?: string[];
  languages?: string[];
  specialties?: string[];
  cityDistrict?: string;
  livedExperience?: string;
  serviceBoundaries?: string[];
  voiceIntroAssetRef?: string;
  voiceIntroDurationSeconds?: number;
  availability?: "online" | "available" | "busy";
};

export type CommercialProfileSubmission = {
  settlementRecipientRef: string;
  settlementRecipientMasked: string;
  taxProfileRef: string;
  identityEvidenceRef: string;
  serviceAgreementVersion: string;
  serviceAgreementEvidenceRef: string;
};

export type TrainingQuestion = {
  id: string;
  prompt: string;
  options: Array<{ value: "A" | "B" | "C" | "D"; label: string }>;
};

export type TrainingModule = {
  code: string;
  version: string;
  title: string;
  kind: "onboarding" | "required" | "continuingEducation";
  summary: string;
  passScore: number;
  validityDays: number;
  questions: TrainingQuestion[];
  record: null | {
    id: string;
    status: "inProgress" | "passed" | "expired";
    attemptCount: number;
    bestScore: number;
    passedAt: string | null;
    expiresAt: string | null;
  };
};

export type CompanionLifecycleOverview = {
  companion: {
    id: string;
    name: string;
    role: string;
    bio: string;
    languages: string[];
    specialties: string[];
    cityDistrict: string;
    livedExperience: string | null;
    serviceBoundaries: string[];
    isPublished: boolean;
    voiceIntro: {
      assetReference: string | null;
      durationSeconds: number | null;
      status: "notSubmitted" | "pendingReview" | "approved" | "rejected";
    };
  };
  commercialProfile: {
    status: "notSubmitted" | "pendingReview" | "verified" | "suspended";
    settlementRecipientMasked: string | null;
    serviceAgreementVersion: string | null;
    submittedAt: string | null;
    verifiedAt: string | null;
    suspendedAt: string | null;
    suspendedReason: string | null;
    nextReviewDueAt: string | null;
    adultEligibility: {
      verdict: "pending" | "adult" | "ineligible";
      verifiedAt: string | null;
      validUntil: string | null;
      evidenceAvailable: boolean;
    };
    evidence: {
      settlementRecipient: boolean;
      taxProfile: boolean;
      identity: boolean;
      serviceAgreement: boolean;
    };
  };
  training: {
    complete: boolean;
    requiredModuleCodes: string[];
    modules: TrainingModule[];
  };
  quality: CompanionQuality;
  actions: { items: CompanionAccountAction[] };
  incidents: { items: CompanionIncident[] };
  withdrawals: { items: CompanionWithdrawal[] };
  operationalSummary: {
    activeRestrictionCount: number;
    openIncidentCount: number;
  };
};

export type CompanionQuality = {
  generatedAt: string;
  orderSampleSize: number;
  orderSampleLimit: number;
  orderPopulationSize: number;
  orderSampleTruncated: boolean;
  acceptedWithinDeadline: RateMetric;
  startedWithinTenMinutes: RateMetric;
  completion: RateMetric;
  refund: RateMetric;
  rating: { value: number | null; sampleSize: number };
  openSupportTickets: number;
  activeAccountActions: number;
  limitations: string[];
};

export type RateMetric = { value: number | null; numerator: number; denominator: number };

export type CompanionAccountAction = {
  id: string;
  kind: "warning" | "serviceRestriction" | "suspension";
  reasonCode: string;
  message: string;
  startsAt: string;
  endsAt: string | null;
  appealDeadlineAt: string;
  appealWindowOpen: boolean;
  revokedAt: string | null;
  active: boolean;
  createdAt: string;
  appeals: Array<{
    id: string;
    status: "pending" | "upheld" | "overturned" | "dismissed";
    statement: string;
    evidenceReferences: string[];
    reviewDueAt: string;
    overdue: boolean;
    resolution: string | null;
    createdAt: string;
  }>;
};

export type CompanionIncident = {
  id: string;
  orderId: string | null;
  category: "technicalIssue" | "lateArrival" | "noShow" | "harassment" | "safetyBoundary" | "other";
  summary: string;
  evidenceAttachments: Array<{
    id: string;
    kind: "image" | "audio";
    status: "approved";
    mimeType: string;
    sizeBytes: number;
    durationMs: number | null;
    expiresAt: string | null;
  }>;
  status: "open" | "inReview" | "resolved" | "closed";
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompanionWithdrawal = {
  id: string;
  earningIds: string[];
  amountCents: number;
  settlementRecipientMasked: string;
  status: "requested" | "reviewing" | "approved" | "processing" | "paid" | "rejected" | "cancelled";
  payoutReferenceMasked: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompanionEarning = {
  id: string;
  orderId: string;
  grossCents: number;
  platformFeeCents: number;
  payableCents: number;
  status: "pending" | "available" | "held" | "paid" | "void";
  availableAt: string;
  holdReason: string | null;
  paidAt: string | null;
  settlementRecipientMasked: string | null;
};

export type LedgerPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type CompanionEarningsSummary = {
  totalCount: number;
  availableCents: number;
  pendingOrHeldCents: number;
  paidCents: number;
  byStatus: Record<CompanionEarning["status"], { count: number; payableCents: number }>;
};

export type RecurringAvailabilityRule = {
  id: string;
  weekday: number;
  startsAtMinute: number;
  endsAtMinute: number;
  capacity: number;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AvailabilityBlackout = {
  id: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RecurringAvailabilityDraft = {
  id: string;
  recurringAvailabilityRuleId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  timezone: string;
  isActive: boolean;
};

export type SupportTicket = {
  id: string;
  orderId: string | null;
  category: "orderIssue" | "refund" | "safety" | "privacy" | "general";
  priority: "normal" | "high" | "urgent";
  status: "open" | "inProgress" | "resolved" | "closed";
  subject: string;
  body: string;
  dueAt: string | null;
  resolution: string | null;
  resolutionCode: string | null;
  orderFacts: Array<{ id: string; statement: string; evidenceAttachments: Array<Record<string, unknown>>; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
};

export const companionCommercialApi = {
  apply: (input: CompanionApplicationInput) =>
    request<Record<string, unknown>>("/companions/me/application", {
      method: "POST",
      data: { ...input }
    }),
  updateProfile: (input: CompanionProfileUpdate) =>
    request<Record<string, unknown>>("/companions/me/profile", {
      method: "PATCH",
      data: { ...input }
    }),
  overview: () =>
    request<CompanionLifecycleOverview>("/commercial/companion/overview"),
  submitCommercialProfile: (input: CommercialProfileSubmission) =>
    request<CompanionLifecycleOverview["commercialProfile"]>("/commercial/companion/profile/submissions", {
      method: "POST",
      data: { ...input }
    }),
  training: () =>
    request<CompanionLifecycleOverview["training"]>("/commercial/companion/training"),
  submitTrainingAttempt: (moduleCode: string, moduleVersion: string, answers: string[]) =>
    request<{
      moduleCode: string;
      moduleVersion: string;
      score: number;
      passScore: number;
      passed: boolean;
    }>("/commercial/companion/training/attempts", {
      method: "POST",
      data: { moduleCode, moduleVersion, answers }
    }),
  quality: () =>
    request<CompanionQuality>("/commercial/companion/quality"),
  actions: (options: { page?: number; pageSize?: number; active?: boolean; actionId?: string } = {}) => {
    const query = [
      options.page ? `page=${options.page}` : "",
      options.pageSize ? `pageSize=${options.pageSize}` : "",
      options.active === undefined ? "" : `active=${options.active ? "true" : "false"}`,
      options.actionId ? `actionId=${encodeURIComponent(options.actionId)}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: CompanionAccountAction[]; pagination: LedgerPagination }>(
      `/commercial/companion/actions${query ? `?${query}` : ""}`
    );
  },
  appealAction: (actionId: string, statement: string, evidenceReferences: string[]) =>
    request<Record<string, unknown>>(`/commercial/companion/actions/${encodeURIComponent(actionId)}/appeals`, {
      method: "POST",
      data: { statement, evidenceReferences }
    }),
  incidents: (options: { page?: number; pageSize?: number; status?: CompanionIncident["status"] } = {}) => {
    const query = [
      options.page ? `page=${options.page}` : "",
      options.pageSize ? `pageSize=${options.pageSize}` : "",
      options.status ? `incidentStatus=${encodeURIComponent(options.status)}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: CompanionIncident[]; pagination: LedgerPagination }>(
      `/commercial/companion/incidents${query ? `?${query}` : ""}`
    );
  },
  createIncident: (input: {
    orderId?: string;
    category: CompanionIncident["category"];
    summary: string;
    evidenceAssetIds: string[];
  }) =>
    request<CompanionIncident>("/commercial/companion/incidents", {
      method: "POST",
      data: { ...input }
    }),
  withdrawals: (options: { page?: number; pageSize?: number; status?: CompanionWithdrawal["status"] } = {}) => {
    const query = [
      options.page ? `page=${options.page}` : "",
      options.pageSize ? `pageSize=${options.pageSize}` : "",
      options.status ? `withdrawalStatus=${encodeURIComponent(options.status)}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: CompanionWithdrawal[]; pagination: LedgerPagination }>(
      `/commercial/companion/withdrawals${query ? `?${query}` : ""}`
    );
  },
  requestWithdrawal: (earningIds: string[]) =>
    request<CompanionWithdrawal>("/commercial/companion/withdrawals", {
      method: "POST",
      data: { earningIds }
    }),
  cancelWithdrawal: (requestId: string) =>
    request<CompanionWithdrawal>(`/commercial/companion/withdrawals/${encodeURIComponent(requestId)}/cancel`, {
      method: "POST"
    }),
  earnings: (options: { page?: number; pageSize?: number; status?: CompanionEarning["status"] } = {}) => {
    const query = [
      options.page ? `page=${options.page}` : "",
      options.pageSize ? `pageSize=${options.pageSize}` : "",
      options.status ? `status=${encodeURIComponent(options.status)}` : ""
    ].filter(Boolean).join("&");
    return request<{
      items: CompanionEarning[];
      pagination: LedgerPagination;
      summary: CompanionEarningsSummary;
    }>(`/commercial/earnings/me${query ? `?${query}` : ""}`);
  },
  recurringRules: (options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${options.page}` : "",
      options.pageSize ? `pageSize=${options.pageSize}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: RecurringAvailabilityRule[]; pagination: LedgerPagination }>(
      `/companions/me/availability-schedule/rules${query ? `?${query}` : ""}`
    );
  },
  createRecurringRule: (input: {
    weekday: number;
    startsAtMinute: number;
    endsAtMinute: number;
    capacity: number;
  }) =>
    request<RecurringAvailabilityRule>("/companions/me/availability-schedule/rules", {
      method: "POST",
      data: { ...input }
    }),
  deactivateRecurringRule: (ruleId: string) =>
    request<RecurringAvailabilityRule>(
      `/companions/me/availability-schedule/rules/${encodeURIComponent(ruleId)}/deactivate`,
      { method: "PATCH" }
    ),
  blackouts: (options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${options.page}` : "",
      options.pageSize ? `pageSize=${options.pageSize}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: AvailabilityBlackout[]; pagination: LedgerPagination }>(
      `/companions/me/availability-schedule/blackouts${query ? `?${query}` : ""}`
    );
  },
  createBlackout: (startsAt: string, endsAt: string) =>
    request<AvailabilityBlackout>("/companions/me/availability-schedule/blackouts", {
      method: "POST",
      data: { startsAt, endsAt }
    }),
  deactivateBlackout: (blackoutId: string) =>
    request<AvailabilityBlackout>(
      `/companions/me/availability-schedule/blackouts/${encodeURIComponent(blackoutId)}/deactivate`,
      { method: "PATCH" }
    ),
  recurringDrafts: (options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${options.page}` : "",
      options.pageSize ? `pageSize=${options.pageSize}` : ""
    ].filter(Boolean).join("&");
    return request<{
      horizonEndsAt: string;
      items: RecurringAvailabilityDraft[];
      pagination: LedgerPagination;
    }>(`/companions/me/availability-schedule/drafts${query ? `?${query}` : ""}`);
  },
  materializeRecurringDrafts: () =>
    request<{
      evaluatedRules: number;
      consideredOccurrences: number;
      created: number;
      alreadyMaterialized: number;
      skippedByBlackout: number;
      skippedByExistingWindow: number;
      skippedByOrder: number;
      skippedOutsideHorizon: number;
    }>("/companions/me/availability-schedule/drafts/materialize", { method: "POST" }),
  activateRecurringDraft: (draftId: string) =>
    request<Record<string, unknown>>(
      `/companions/me/availability-schedule/drafts/${encodeURIComponent(draftId)}/activate`,
      { method: "PATCH" }
    ),
  supportTickets: (options: { page?: number; pageSize?: number; status?: SupportTicket["status"] } = {}) => {
    const query = [
      options.page ? `page=${options.page}` : "",
      options.pageSize ? `pageSize=${options.pageSize}` : "",
      options.status ? `status=${encodeURIComponent(options.status)}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: SupportTicket[]; pagination: LedgerPagination }>(
      `/support/tickets/me${query ? `?${query}` : ""}`
    );
  },
  supportTicket: (ticketId: string) =>
    request<SupportTicket>(`/support/tickets/${encodeURIComponent(ticketId)}`),
  supportTicketsByOrder: (orderId: string, options: { page?: number; pageSize?: number } = {}) => {
    const query = [
      options.page ? `page=${options.page}` : "",
      options.pageSize ? `pageSize=${options.pageSize}` : ""
    ].filter(Boolean).join("&");
    return request<{ items: SupportTicket[]; pagination: LedgerPagination }>(
      `/support/orders/${encodeURIComponent(orderId)}/tickets${query ? `?${query}` : ""}`
    );
  },
  createSupportTicket: (input: {
    orderId?: string;
    category: SupportTicket["category"];
    subject: string;
    body: string;
  }) =>
    request<SupportTicket>("/support/tickets", {
      method: "POST",
      data: { ...input }
    }),
  addOrderFact: (ticketId: string, statement: string, evidenceAssetIds: string[] = []) =>
    request<Record<string, unknown>>(`/support/tickets/${encodeURIComponent(ticketId)}/order-facts`, {
      method: "POST",
      data: { statement, ...(evidenceAssetIds.length ? { evidenceAssetIds } : {}) }
    })
};
