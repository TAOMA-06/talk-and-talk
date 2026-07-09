import { UsersService } from "./users.service";

describe("UsersService", () => {
  const prisma = {
    user: {
      findUnique: jest.fn()
    },
    userProfile: {
      upsert: jest.fn()
    }
  } as any;

  const audit = { record: jest.fn().mockResolvedValue({}) } as any;
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(prisma, audit);
  });

  it("updates only safe profile fields", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: "u1", role: "user" })
      .mockResolvedValueOnce({
        id: "u1",
        role: "user",
        profile: {
          displayName: "小楷",
          phone: "+8613800138000",
          age: 20,
          gender: "male",
          isVerified: false,
          safetyScore: 80
        }
      });
    prisma.userProfile.upsert.mockResolvedValue({});

    const result = await service.updateMe("u1", {
      displayName: "小楷",
      gender: "male",
      age: 20,
      role: "admin",
      safetyScore: 0
    } as any);

    expect(prisma.userProfile.upsert).toHaveBeenCalledWith({
      where: { userId: "u1" },
      create: { userId: "u1", displayName: "小楷", gender: "male", age: 20 },
      update: { displayName: "小楷", gender: "male", age: 20 }
    });
    expect(result.profile!.safetyScore).toBe(80);
  });

  it("updates only provided profile fields", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: "u1", role: "user" })
      .mockResolvedValueOnce({
        id: "u1",
        role: "user",
        profile: {
          displayName: "小楷",
          phone: "+8613800138000",
          age: 20,
          gender: "male",
          isVerified: false,
          safetyScore: 80
        }
      });
    prisma.userProfile.upsert.mockResolvedValue({});

    await service.updateMe("u1", { age: 23 });

    expect(prisma.userProfile.upsert).toHaveBeenCalledWith({
      where: { userId: "u1" },
      create: { userId: "u1", age: 23 },
      update: { age: 23 }
    });
  });

  it("skips upsert when no profile fields are provided", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: "u1", role: "user" })
      .mockResolvedValueOnce({
        id: "u1",
        role: "user",
        profile: {
          displayName: "小楷",
          phone: "+8613800138000",
          age: 20,
          gender: "male",
          isVerified: false,
          safetyScore: 80
        }
      });

    await service.updateMe("u1", {});

    expect(prisma.userProfile.upsert).not.toHaveBeenCalled();
  });
});
