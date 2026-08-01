/**
 * Authoritative required transaction-template manifest.
 * `availabilityReminder` is optional and remains separately gated.
 */
module.exports = Object.freeze([
  { key: "newOrder", defaultPage: "pages/orders/index" },
  { key: "orderConfirmed", defaultPage: "pages/orders/index" },
  { key: "orderRejected", defaultPage: "pages/orders/index" },
  { key: "orderResponseExpired", defaultPage: "pages/orders/index" },
  { key: "paymentSuccess", defaultPage: "pages/orders/index" },
  { key: "serviceStarted", defaultPage: "pages/orders/index" },
  { key: "serviceCompleted", defaultPage: "pages/orders/index" },
  { key: "orderCancelled", defaultPage: "pages/orders/index" },
  { key: "reservationExpired", defaultPage: "pages/orders/index" },
  { key: "rescheduleRequested", defaultPage: "pages/orders/index" },
  { key: "rescheduleAccepted", defaultPage: "pages/orders/index" },
  { key: "rescheduleRejected", defaultPage: "pages/orders/index" },
  { key: "rescheduleExpired", defaultPage: "pages/orders/index" },
  { key: "rescheduleCancelled", defaultPage: "pages/orders/index" },
  { key: "supportUpdate", defaultPage: "pages/support/index" },
  { key: "messageReceived", defaultPage: "pages/messages/index" }
]);
