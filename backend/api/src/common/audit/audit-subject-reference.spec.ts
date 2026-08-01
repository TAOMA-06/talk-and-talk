import {
  buildAuditSubjectReferenceWrites,
  controlledAuditSubjectCandidates,
  redactControlledAuditSubjectMetadata
} from "./audit-subject-reference";

describe("audit subject reference controls", () => {
  it("builds a bounded, deterministic actor and business-subject write set", () => {
    expect(buildAuditSubjectReferenceWrites("staff-1", ["user-2", "user-1", "user-2"]))
      .toEqual([
        { subjectUserId: "staff-1", relationKind: "actor" },
        { subjectUserId: "user-1", relationKind: "subject" },
        { subjectUserId: "user-2", relationKind: "subject" }
      ]);
  });

  it("extracts only exact action/key allowlisted backfill candidates", () => {
    expect(controlledAuditSubjectCandidates({
      actorId: "staff-1",
      action: "account.deletion_execution_queued",
      metadata: {
        userId: "user-1",
        companionId: "companion-1",
        requestedForUserId: "not-allowlisted-for-this-action",
        nested: { userId: "must-not-be-scanned" }
      }
    })).toEqual([
      { identifierKind: "user", identifier: "staff-1", source: "actorId" },
      { identifierKind: "user", identifier: "user-1", source: "metadata.userId" },
      { identifierKind: "companion", identifier: "companion-1", source: "metadata.companionId" }
    ]);
  });

  it("does not turn the reserved system actor into a User foreign key", () => {
    expect(buildAuditSubjectReferenceWrites("system", ["user-1"]))
      .toEqual([{ subjectUserId: "user-1", relationKind: "subject" }]);
    expect(controlledAuditSubjectCandidates({
      actorId: "system",
      action: "unregistered.action"
    })).toEqual([]);
  });

  it("redacts only exact allowlisted values and preserves all other evidence", () => {
    const original = {
      userId: "user-1",
      companionId: "companion-other",
      note: "case mentions user-1 but is not an identity field",
      nested: { userId: "user-1" },
      amountCents: 3900
    };
    expect(redactControlledAuditSubjectMetadata(
      "account.deletion_execution_queued",
      original,
      { userIds: new Set(["user-1"]), companionIds: new Set(["companion-1"]) }
    )).toEqual({
      metadata: {
        companionId: "companion-other",
        note: "case mentions user-1 but is not an identity field",
        nested: { userId: "user-1" },
        amountCents: 3900,
        retentionExpired: true
      },
      redactedKeys: ["userId"]
    });
    expect(original).toHaveProperty("userId", "user-1");
  });

  it("rejects invalid or unbounded explicit subject lists", () => {
    expect(() => buildAuditSubjectReferenceWrites(null, ["contains whitespace"])).toThrow(
      "Audit subject user id is invalid"
    );
    expect(() => buildAuditSubjectReferenceWrites(
      null,
      Array.from({ length: 17 }, (_, index) => `user-${index}`)
    )).toThrow("Audit subject reference limit exceeded");
    expect(() => buildAuditSubjectReferenceWrites(
      "actor-not-in-subject-list",
      Array.from({ length: 16 }, (_, index) => `user-${index}`)
    )).toThrow("Audit subject reference limit exceeded");
  });
});
