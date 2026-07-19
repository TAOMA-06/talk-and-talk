import "reflect-metadata";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { UpdateMeDto, USER_GENDERS } from "./update-me.dto";

describe("UpdateMeDto", () => {
  it.each(USER_GENDERS)("accepts the supported gender %s", async (gender) => {
    const errors = await validate(plainToInstance(UpdateMeDto, { gender }));

    expect(errors).toHaveLength(0);
  });

  it.each(["other", "undisclosed", "", "FEMALE", 1])("rejects unsupported gender %p", async (gender) => {
    const errors = await validate(plainToInstance(UpdateMeDto, { gender }));

    expect(errors.some((error) => error.property === "gender" && error.constraints?.isIn)).toBe(true);
  });
});
