import { validate } from "class-validator";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { WechatMiniProgramLoginDto } from "./dto/wechat-mini-program-login.dto";

describe("AuthController WeChat Mini Program boundary", () => {
  const loginWithWechatMiniProgram = jest.fn();
  const wechatMiniProgramStatus = jest.fn();
  const logout = jest.fn();
  const controller = new AuthController({
    loginWithWechatMiniProgram,
    wechatMiniProgramStatus,
    logout
  } as unknown as AuthService);

  beforeEach(() => {
    loginWithWechatMiniProgram.mockReset();
    logout.mockReset();
  });

  it("passes the wx.login code through and returns the frontend session shape", async () => {
    const session = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 900,
      user: { id: "wechat-user", role: "user", profile: null }
    };
    loginWithWechatMiniProgram.mockResolvedValue(session);

    await expect(controller.wechatMiniProgramLogin({ code: "wx-login-code" }))
      .resolves.toEqual(session);
    expect(loginWithWechatMiniProgram).toHaveBeenCalledWith("wx-login-code");
  });

  it("passes only cleaned, length-bounded client headers into the new session", async () => {
    loginWithWechatMiniProgram.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 900,
      user: { id: "wechat-user", role: "user", profile: null }
    });

    await controller.wechatMiniProgramLogin(
      { code: "wx-login-code" },
      {
        headers: {
          "x-client-label": "  微信\n小程序  ",
          "x-client-platform": `wechat-${"x".repeat(80)}`
        }
      } as any
    );

    expect(loginWithWechatMiniProgram).toHaveBeenCalledWith("wx-login-code", {
      sessionLabel: "微信 小程序",
      clientPlatform: `wechat-${"x".repeat(25)}`
    });
  });

  it("marks an empty wx.login code invalid before it reaches the controller", async () => {
    const dto = new WechatMiniProgramLoginDto();
    dto.code = "";

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty("minLength");
    expect(loginWithWechatMiniProgram).not.toHaveBeenCalled();
  });

  it("exposes readiness without exposing the AppSecret", () => {
    wechatMiniProgramStatus.mockReturnValue({
      module: "wechatMiniProgram",
      status: "configured",
      configured: true
    });

    expect(controller.wechatMiniProgramStatus()).toEqual({
      module: "wechatMiniProgram",
      status: "configured",
      configured: true
    });
  });

  it("binds logout revocation to the authenticated user", async () => {
    logout.mockResolvedValue(undefined);

    await expect(controller.logout(
      { id: "user-1", role: "user", sessionId: "session-1" },
      { refreshToken: "refresh-token" }
    )).resolves.toEqual({ success: true });

    expect(logout).toHaveBeenCalledWith("user-1", "refresh-token");
  });
});
