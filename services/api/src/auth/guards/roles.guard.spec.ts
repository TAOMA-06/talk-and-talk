import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { RolesGuard } from "./roles.guard";

function createContext(user: { role: string } | undefined, handler = jest.fn()): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user })
    }),
    getHandler: () => handler,
    getClass: () => handler
  } as unknown as ExecutionContext;
}

describe("RolesGuard", () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it("should allow when no roles required", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
    expect(guard.canActivate(createContext({ role: "user" }))).toBe(true);
  });

  it("should allow when user has matching role", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(["admin"]);
    expect(guard.canActivate(createContext({ role: "admin" }))).toBe(true);
  });

  it("should reject when user role does not match", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(["admin"]);
    expect(() => guard.canActivate(createContext({ role: "user" }))).toThrow("Insufficient permissions");
  });

  it("should reject when no user present", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(["admin"]);
    expect(() => guard.canActivate(createContext(undefined))).toThrow("Insufficient permissions");
  });
});
