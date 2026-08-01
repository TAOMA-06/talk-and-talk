import type { ApiError } from "./api";

const ADULT_ELIGIBILITY_ERROR_CODES = new Set([
  "CUSTOMER_ADULT_ELIGIBILITY_REQUIRED",
  "CUSTOMER_ADULT_ELIGIBILITY_PENDING",
  "CUSTOMER_ADULT_ELIGIBILITY_INELIGIBLE",
  "CUSTOMER_ADULT_ELIGIBILITY_EXPIRED",
  "CUSTOMER_ADULT_ELIGIBILITY_VALIDITY_TOO_SHORT"
]);

export function isCustomerAdultEligibilityError(error: unknown): error is ApiError {
  const code = (error as ApiError)?.code;
  return typeof code === "string" && ADULT_ELIGIBILITY_ERROR_CODES.has(code);
}

function recoveryMessage(error: ApiError): string {
  switch (error.code) {
    case "CUSTOMER_ADULT_ELIGIBILITY_PENDING":
      return "你的成年资格核验正在等待另一名授权人员复核。通过前不能新建、改期或支付新的付费服务；已有订单、退款和账号权利仍可使用。";
    case "CUSTOMER_ADULT_ELIGIBILITY_INELIGIBLE":
      return "当前独立复核结果不满足付费服务资格。你仍可处理已有订单、退款和账号权利，并在核验页查看正式说明。";
    case "CUSTOMER_ADULT_ELIGIBILITY_EXPIRED":
      return "原成年资格核验已过期，需要通过受控流程重新提交。已有订单、退款和账号权利不会因此被隐藏。";
    case "CUSTOMER_ADULT_ELIGIBILITY_VALIDITY_TOO_SHORT":
      return "当前核验有效期无法覆盖所选服务结束时间。请先完成新的受控核验，或返回选择有效期内的服务时间。";
    default:
      return "付费服务前必须完成服务端成年资格独立核验。资料页年龄或协议勾选不能替代这项核验。";
  }
}

export async function handleCustomerAdultEligibilityError(
  error: unknown,
  subject: "currentUser" | "otherParticipant" = "currentUser"
): Promise<boolean> {
  if (!isCustomerAdultEligibilityError(error)) return false;
  if (subject === "otherParticipant") {
    await new Promise<void>((resolve) => wx.showModal({
      title: "客户付费资格需要处理",
      content: "这笔订单的客户成年资格当前无法覆盖本次操作。原预约和已有订单权利保持不变；请等待客户通过自己的账户中心处理，或联系平台客服。",
      showCancel: false,
      confirmText: "我知道了",
      success: () => resolve(),
      fail: () => resolve()
    }));
    return true;
  }
  const result = await new Promise<any>((resolve) => wx.showModal({
    title: "请先处理成年资格核验",
    content: recoveryMessage(error as ApiError),
    confirmText: "查看核验状态",
    cancelText: "稍后处理",
    success: resolve,
    fail: () => resolve({ confirm: false })
  }));
  if (result.confirm) wx.navigateTo({ url: "/pages/account/adult-eligibility" });
  return true;
}
