-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'paying', 'paid', 'inService', 'completed', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "PaymentTxnStatus" AS ENUM ('initiated', 'success', 'failed', 'closed');

-- CreateEnum
CREATE TYPE "RefundTxnStatus" AS ENUM ('pending', 'processing', 'success', 'failed');

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "conversationId" TEXT,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "outTradeNo" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'wechat',
    "amountCents" INTEGER NOT NULL,
    "status" "PaymentTxnStatus" NOT NULL DEFAULT 'initiated',
    "prepayId" TEXT,
    "transactionId" TEXT,
    "clientParams" JSONB,
    "notifyPayload" JSONB,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundTransaction" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "outRefundNo" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "RefundTxnStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "providerRefundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_companionId_status_idx" ON "Order"("companionId", "status");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_conversationId_idx" ON "Order"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_outTradeNo_key" ON "PaymentTransaction"("outTradeNo");

-- CreateIndex
CREATE INDEX "PaymentTransaction_orderId_idx" ON "PaymentTransaction"("orderId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_status_idx" ON "PaymentTransaction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_provider_transactionId_key" ON "PaymentTransaction"("provider", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundTransaction_outRefundNo_key" ON "RefundTransaction"("outRefundNo");

-- CreateIndex
CREATE INDEX "RefundTransaction_orderId_idx" ON "RefundTransaction"("orderId");

-- CreateIndex
CREATE INDEX "RefundTransaction_paymentId_idx" ON "RefundTransaction"("paymentId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "CompanionProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundTransaction" ADD CONSTRAINT "RefundTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundTransaction" ADD CONSTRAINT "RefundTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
