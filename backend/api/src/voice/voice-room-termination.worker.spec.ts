import { VoiceRoomTerminationWorker } from "./voice-room-termination.worker";

describe("VoiceRoomTerminationWorker", () => {
  it("runs the durable scan only when room control is explicitly enabled", async () => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === "TRTC_ROOM_CONTROL_ENABLED") return true;
        if (key === "TRTC_ROOM_CONTROL_BATCH_SIZE") return 5;
        return undefined;
      })
    } as any;
    const rooms = {
      dismissDueRooms: jest.fn().mockResolvedValue({ skipped: false, claimed: 2, terminated: 2, retriesScheduled: 0 })
    } as any;
    const worker = new VoiceRoomTerminationWorker(config, rooms);

    await expect(worker.dismissDue()).resolves.toEqual({
      skipped: false,
      claimed: 2,
      terminated: 2,
      retriesScheduled: 0
    });
    expect(rooms.dismissDueRooms).toHaveBeenCalledWith(5);
  });

  it("does not scan or retain work when the feature flag is off", async () => {
    const config = { get: jest.fn(() => false) } as any;
    const rooms = { dismissDueRooms: jest.fn() } as any;
    const worker = new VoiceRoomTerminationWorker(config, rooms);

    await expect(worker.dismissDue()).resolves.toEqual({
      skipped: true,
      claimed: 0,
      terminated: 0,
      retriesScheduled: 0
    });
    expect(rooms.dismissDueRooms).not.toHaveBeenCalled();
  });
});
