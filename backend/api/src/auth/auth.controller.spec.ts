import { validate } from "class-validator";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { WechatMiniProgramLoginDto } from "./dto/wechat-mini-program-login.dto";

describe("AuthController WeChat Mini Program boundary", () => {
  const loginWithWechatMiniProgram = jest.fn();
  const wechatMiniProgramStatus = jest.fn();
  const controller = new AuthController({
    loginWithWechatMiniProgram,
    wechatMiniProgramStatus
  } as unknown as AuthService);

  beforeEach(() => loginWithWechatMiniProgram.mockReset());

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
});
