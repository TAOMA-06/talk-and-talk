"use client";

import {
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  Smartphone,
  X,
} from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";

import { requestApi } from "../lib/api-client";
import { currency, orderTitle, readableError } from "../lib/format";
import type { Order } from "../lib/types";

type NativePrepayResponse = {
  order: Order;
  payment: {
    outTradeNo: string;
    channel: "native";
    mock: boolean;
    wechatNativeParams?: {
      codeUrl?: string;
    };
  };
};

type PaymentSyncResponse = {
  code: "SUCCESS" | "PENDING";
  message: string;
  data: {
    orderId: string;
    orderStatus: string;
  };
};

export default function WechatNativePayModal({
  order,
  onClose,
  onPaid,
}: {
  order: Order;
  onClose: () => void;
  onPaid: () => void | Promise<void>;
}) {
  const [qrCode, setQrCode] = useState("");
  const [outTradeNo, setOutTradeNo] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState("");
  const handledPaid = useRef(false);
  const onPaidRef = useRef(onPaid);

  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  const finishPaid = useCallback(async () => {
    if (handledPaid.current) return;
    handledPaid.current = true;
    setPaid(true);
    await onPaidRef.current();
  }, []);

  const syncPayment = useCallback(async () => {
    if (handledPaid.current) return;
    setChecking(true);
    try {
      const result = await requestApi<PaymentSyncResponse>(
        `/orders/${encodeURIComponent(order.id)}/payment/sync`,
        { method: "POST" },
      );
      if (
        result.code === "SUCCESS" ||
        ["paid", "inService", "completed"].includes(result.data.orderStatus)
      ) {
        await finishPaid();
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setChecking(false);
    }
  }, [finishPaid, order.id]);

  const preparePayment = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await requestApi<NativePrepayResponse>(
        `/orders/${encodeURIComponent(order.id)}/prepay`,
        {
          method: "POST",
          data: { channel: "native" },
        },
      );
      const codeUrl = result.payment.wechatNativeParams?.codeUrl?.trim();
      if (!codeUrl) throw new Error("支付二维码生成失败，请稍后重试");
      const image = await QRCode.toDataURL(codeUrl, {
        width: 260,
        margin: 1,
        errorCorrectionLevel: "M",
        color: {
          dark: "#3c252b",
          light: "#fffdfb",
        },
      });
      setOutTradeNo(result.payment.outTradeNo);
      setQrCode(image);
      if (result.payment.mock) {
        window.setTimeout(() => void syncPayment(), 800);
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setLoading(false);
    }
  }, [order.id, syncPayment]);

  useEffect(() => {
    const timer = window.setTimeout(() => void preparePayment(), 0);
    return () => window.clearTimeout(timer);
  }, [preparePayment]);

  useEffect(() => {
    if (!qrCode || paid) return;
    const interval = window.setInterval(() => void syncPayment(), 3_000);
    return () => window.clearInterval(interval);
  }, [paid, qrCode, syncPayment]);

  return (
    <div className="modal-backdrop">
      <section
        className="modal-card payment-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-title"
      >
        <button className="modal-close" onClick={onClose} aria-label="关闭">
          <X size={19} />
        </button>
        <span className={paid ? "modal-illustration success" : "modal-illustration"}>
          {paid ? <CheckCircle2 size={28} /> : <Smartphone size={28} />}
        </span>
        <p className="eyebrow">微信扫码支付</p>
        <h2 id="payment-title">{paid ? "支付已确认" : "请使用微信扫码"}</h2>
        <p>
          {paid
            ? "平台已经收到微信支付结果，订单状态正在更新。"
            : "请在 15 分钟内完成支付。支付结果以微信回调和服务端查询为准。"}
        </p>

        <div className="payment-summary">
          <span>{orderTitle(order)}</span>
          <strong>{currency(order.amountCents)}</strong>
        </div>

        {loading ? (
          <div className="payment-qr-state" role="status">
            <LoaderCircle className="spin" size={28} />
            <span>正在向微信申请支付二维码…</span>
          </div>
        ) : paid ? (
          <div className="payment-success-panel">
            <CheckCircle2 size={44} />
            <strong>付款成功</strong>
            <span>现在可以关闭窗口查看订单。</span>
          </div>
        ) : qrCode ? (
          <div className="payment-qr-panel">
            {/* Generated locally from the merchant-issued code_url; no payment token is sent to a third party. */}
            <Image
              src={qrCode}
              alt="微信支付二维码"
              width={260}
              height={260}
              unoptimized
            />
            <span>打开微信 · 扫一扫</span>
            {outTradeNo && <small>支付单号：{outTradeNo.slice(-12)}</small>}
          </div>
        ) : null}

        {error && <div className="inline-notice error">{error}</div>}

        <div className="payment-modal-actions">
          {!paid && !loading && !qrCode && (
            <button className="button button-primary" onClick={() => void preparePayment()}>
              重新生成二维码
            </button>
          )}
          {!paid && qrCode && (
            <button
              className="button button-secondary"
              disabled={checking}
              onClick={() => void syncPayment()}
            >
              <RefreshCw className={checking ? "spin" : ""} size={16} />
              {checking ? "正在查询…" : "我已完成支付"}
            </button>
          )}
          <button className="button button-ghost" onClick={onClose}>
            {paid ? "完成" : "稍后支付"}
          </button>
        </div>
      </section>
    </div>
  );
}
