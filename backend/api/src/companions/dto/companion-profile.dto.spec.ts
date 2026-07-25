import { validate } from "class-validator";

import { CreateCompanionDto, UpdateCompanionDto } from "./companion-profile.dto";

describe("companion profile trust fields", () => {
  it("rejects direct admin writes to derived trust metrics", async () => {
    const dto = Object.assign(new UpdateCompanionDto(), {
      rating: 5,
      reviewCount: 999,
      completedOrders: 999,
      responseTime: "秒回"
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property).sort()).toEqual([
      "completedOrders",
      "rating",
      "responseTime",
      "reviewCount"
    ]);
  });

  it("keeps derived fields optional when an unpublished profile is created", async () => {
    const dto = Object.assign(new CreateCompanionDto(), {
      name: "林屿",
      role: "倾听者",
      initials: "LY",
      tags: ["情绪倾听"],
      pricePerHalfHour: 39,
      isOnline: false,
      isVerified: false,
      bio: "平台内提供非医疗陪伴。",
      availableTimes: ["20:00"],
      languages: ["中文"],
      specialties: ["情绪倾听"],
      distanceKm: 0,
      availability: "available",
      cityDistrict: "南山区"
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });
});
