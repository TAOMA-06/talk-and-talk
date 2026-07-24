import { validate } from "class-validator";

import { OwnRecurringAvailabilityDraftParamsDto } from "./manage-recurring-availability-draft.dto";

describe("OwnRecurringAvailabilityDraftParamsDto", () => {
  it("accepts only a server-generated UUID draft id", async () => {
    const valid = Object.assign(new OwnRecurringAvailabilityDraftParamsDto(), {
      id: "123e4567-e89b-42d3-a456-426614174000"
    });
    const invalid = Object.assign(new OwnRecurringAvailabilityDraftParamsDto(), { id: "draft-1" });

    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(validate(invalid)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: "id" })
    ]));
  });
});
