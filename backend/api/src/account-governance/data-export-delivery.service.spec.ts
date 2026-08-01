import { AppException } from "../common/errors/app.exception";
import { DataExportDeliveryService } from "./data-export-delivery.service";

const mockPrisma = {
  dataRightsRequest: {
    findFirst: jest.fn()
  }
};
const mockAudit = { record: jest.fn() };
const configValues: Record<string, unknown> = {
  DATA_EXPORT_DELIVERY_BASE_URL: "https://vault.example.com/private/",
  DATA_EXPORT_DELIVERY_API_KEY: "provider-secret",
  DATA_EXPORT_DELIVERY_TIMEOUT_MS: 5_000,
  DATA_EXPORT_MAX_BYTES: 1_048_576
};
const mockConfig = {
  get: jest.fn((key: string) => configValues[key]),
  getOrThrow: jest.fn((key: string) => {
    if (!(key in configValues)) throw new Error(`missing ${key}`);
    return configValues[key];
  })
};

describe("DataExportDeliveryService", () => {
  const originalFetch = global.fetch;
  let service: DataExportDeliveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    configValues.DATA_EXPORT_DELIVERY_BASE_URL = "https://vault.example.com/private/";
    configValues.DATA_EXPORT_DELIVERY_API_KEY = "provider-secret";
    configValues.DATA_EXPORT_DELIVERY_TIMEOUT_MS = 5_000;
    configValues.DATA_EXPORT_MAX_BYTES = 1_048_576;
    mockAudit.record.mockResolvedValue({});
    service = new DataExportDeliveryService(
      mockPrisma as any,
      mockAudit as any,
      mockConfig as any
    );
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("proxies only an owned completed export without exposing its vault reference", async () => {
    mockPrisma.dataRightsRequest.findFirst.mockResolvedValue({
      id: "rights-1",
      type: "export",
      status: "completed",
      resolutionEvidenceReference: "vault:user-1/export-2026-07"
    });
    const body = Buffer.from('{"version":1,"records":[]}');
    global.fetch = jest.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-length": String(body.length)
      }
    }));

    const result = await service.deliver("user-1", "rights-1");

    expect(mockPrisma.dataRightsRequest.findFirst).toHaveBeenCalledWith({
      where: { id: "rights-1", userId: "user-1" },
      select: {
        id: true,
        type: true,
        status: true,
        resolutionEvidenceReference: true
      }
    });
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toBe(
      "https://vault.example.com/private/v1/exports/vault%3Auser-1%2Fexport-2026-07"
    );
    expect(options).toEqual(expect.objectContaining({
      redirect: "error",
      headers: expect.objectContaining({
        Authorization: "Bearer provider-secret"
      })
    }));
    expect(result).toEqual({
      bytes: body,
      contentType: "application/json",
      filename: "talk-and-talk-data-export-rights-1.json"
    });
    expect(result).not.toHaveProperty("resolutionEvidenceReference");
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "user-1",
      action: "account.data_export_delivered",
      resourceId: "rights-1",
      metadata: { contentType: "application/json", sizeBytes: body.length }
    }));
    const auditInput = mockAudit.record.mock.calls.find(
      ([input]) => input.action === "account.data_export_delivered"
    )?.[0];
    expect(auditInput).not.toHaveProperty("subjectUserIds");
  });

  it("fails closed for a missing, wrong-type, or unfinished request", async () => {
    mockPrisma.dataRightsRequest.findFirst.mockResolvedValue(null);
    await expect(service.deliver("user-1", "rights-1")).rejects.toMatchObject({
      code: "DATA_EXPORT_NOT_FOUND"
    } satisfies Partial<AppException>);

    mockPrisma.dataRightsRequest.findFirst.mockResolvedValue({
      id: "rights-1",
      type: "access",
      status: "completed",
      resolutionEvidenceReference: "vault:access-1"
    });
    await expect(service.deliver("user-1", "rights-1")).rejects.toMatchObject({
      code: "DATA_EXPORT_NOT_READY"
    } satisfies Partial<AppException>);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fails closed when the provider is unconfigured or returns unbounded bytes", async () => {
    mockPrisma.dataRightsRequest.findFirst.mockResolvedValue({
      id: "rights-1",
      type: "export",
      status: "completed",
      resolutionEvidenceReference: "vault:export-1"
    });
    configValues.DATA_EXPORT_DELIVERY_API_KEY = "";
    await expect(service.deliver("user-1", "rights-1")).rejects.toMatchObject({
      code: "DATA_EXPORT_DELIVERY_UNAVAILABLE"
    } satisfies Partial<AppException>);

    configValues.DATA_EXPORT_DELIVERY_API_KEY = "provider-secret";
    global.fetch = jest.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    await expect(service.deliver("user-1", "rights-1")).rejects.toMatchObject({
      code: "DATA_EXPORT_SIZE_INVALID"
    } satisfies Partial<AppException>);
    expect(mockAudit.record).not.toHaveBeenCalled();
  });

  it("rejects a payload whose actual length differs from its declared length", async () => {
    mockPrisma.dataRightsRequest.findFirst.mockResolvedValue({
      id: "rights-1",
      type: "export",
      status: "completed",
      resolutionEvidenceReference: "vault:export-1"
    });
    global.fetch = jest.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": "4"
      }
    }));

    await expect(service.deliver("user-1", "rights-1")).rejects.toMatchObject({
      code: "DATA_EXPORT_SIZE_MISMATCH"
    } satisfies Partial<AppException>);
  });
});
