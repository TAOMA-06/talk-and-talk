import { SKIP_LEGAL_CONSENT_KEY } from "../auth/decorators/skip-legal-consent.decorator";
import { DataExportDeliveryController } from "./data-export-delivery.controller";
import { DataExportDeliveryService } from "./data-export-delivery.service";

describe("DataExportDeliveryController", () => {
  it("binds the export to the authenticated owner and emits safe download headers", async () => {
    const delivery = {
      deliver: jest.fn().mockResolvedValue({
        bytes: Buffer.from("{}"),
        contentType: "application/json",
        filename: "talk-and-talk-data-export-rights-1.json"
      })
    };
    const response = {
      setHeader: jest.fn(),
      send: jest.fn().mockReturnValue("sent")
    };
    const controller = new DataExportDeliveryController(
      delivery as unknown as DataExportDeliveryService
    );

    await expect(controller.download(
      { id: "user-1", role: "user", sessionId: "session-1" },
      "rights-1",
      response as any
    )).resolves.toBe("sent");

    expect(delivery.deliver).toHaveBeenCalledWith("user-1", "rights-1");
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="talk-and-talk-data-export-rights-1.json"'
    );
    expect(response.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(
      Reflect.getMetadata(
        SKIP_LEGAL_CONSENT_KEY,
        DataExportDeliveryController.prototype.download
      )
    ).toBe(true);
  });
});
