import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { ListCompanionsQueryDto } from "./list-companions.dto";

describe("ListCompanionsQueryDto", () => {
  it("accepts the small public taxonomy and delivery modes used by discovery", async () => {
    const dto = Object.assign(new ListCompanionsQueryDto(), {
      topicId: "t3",
      deliveryMode: "voice",
      maxServicePriceCents: 8_800,
      availableWithinDays: 3,
      keyword: "晚间 文字",
      sortBy: "soonestAvailable",
      language: "中文",
      specialty: "情绪倾听"
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it("normalizes a short public keyword and rejects invalid search inputs before they reach the catalog query", async () => {
    const dto = Object.assign(new ListCompanionsQueryDto(), {
      topicId: "private-order-topic",
      deliveryMode: "video",
      maxServicePriceCents: 99,
      availableWithinDays: 8,
      keyword: "",
      sortBy: "privateBehavior",
      language: "",
      specialty: "a".repeat(41)
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining([
      "topicId", "deliveryMode", "maxServicePriceCents", "availableWithinDays", "keyword", "sortBy", "language", "specialty"
    ]));

    const normalized = plainToInstance(ListCompanionsQueryDto, { keyword: "  晚间\n  文字  " });
    await expect(validate(normalized)).resolves.toHaveLength(0);
    expect(normalized.keyword).toBe("晚间 文字");

    const normalizedTrustFilters = plainToInstance(ListCompanionsQueryDto, {
      language: "  English  ",
      specialty: "  温和\n  倾听  "
    });
    await expect(validate(normalizedTrustFilters)).resolves.toHaveLength(0);
    expect(normalizedTrustFilters.language).toBe("English");
    expect(normalizedTrustFilters.specialty).toBe("温和 倾听");

    const tooLong = plainToInstance(ListCompanionsQueryDto, { keyword: "a".repeat(41) });
    await expect(validate(tooLong)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ property: "keyword" })
    ]));
  });
});
