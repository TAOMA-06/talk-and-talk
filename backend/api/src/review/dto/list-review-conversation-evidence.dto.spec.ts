import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { ListReviewConversationEvidenceDto } from "./list-review-conversation-evidence.dto";

describe("ListReviewConversationEvidenceDto", () => {
  it.each(["before", "after"] as const)("rejects an oversized %s cursor", async (field) => {
    const dto = plainToInstance(ListReviewConversationEvidenceDto, {
      [field]: "x".repeat(129),
      pageSize: "50"
    });

    const errors = await validate(dto);

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: field })
    ]));
  });

  it("accepts bounded cursors and transforms the page size", async () => {
    const dto = plainToInstance(ListReviewConversationEvidenceDto, {
      before: "message-cursor",
      pageSize: "25"
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.pageSize).toBe(25);
  });
});
