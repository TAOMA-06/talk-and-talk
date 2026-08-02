import { TEST_MOCK_WECHAT_NOTIFY_SECRET, MockWeChatPayProvider } from "./mock-wechat-pay.provider";

describe("MockWeChatPayProvider complaint contract", () => {
  it("supports notify, query, reply, complete and compensating list flows", async () => {
    const provider = new MockWeChatPayProvider();
    const raw = JSON.stringify({
      id: "notice-1",
      create_time: "2026-07-31T10:00:00+08:00",
      event_type: "COMPLAINT.CREATE",
      resource: {
        plaintext: {
          complaint_id: "complaint-1",
          action_type: "CREATE_COMPLAINT",
          out_trade_no: "trade-1",
          complaint_detail: "服务问题",
          complaint_state: "PENDING"
        }
      }
    });

    expect(provider.verifyNotifySignature({ "x-mock-wechat-token": TEST_MOCK_WECHAT_NOTIFY_SECRET }, raw)).toBe(true);
    expect(provider.parseComplaintNotifyPayload(raw)).toMatchObject({
      complaintId: "complaint-1",
      actionType: "CREATE_COMPLAINT"
    });
    expect(await provider.queryComplaint("complaint-1")).toMatchObject({
      complaintState: "PENDING",
      complaintOrders: [{ outTradeNo: "trade-1" }]
    });
    expect((await provider.listComplaints({ beginDate: "2026-07-30", endDate: "2026-07-31", limit: 50, offset: 0 })).totalCount).toBe(1);

    await provider.replyComplaint({ complaintId: "complaint-1", responseContent: "我们正在处理" });
    expect((await provider.queryComplaint("complaint-1")).complaintState).toBe("PROCESSING");

    await provider.completeComplaint("complaint-1");
    expect((await provider.queryComplaint("complaint-1")).complaintState).toBe("PROCESSED");
  });
});
