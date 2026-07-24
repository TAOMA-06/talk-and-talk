import { openLegalDocument } from "../../utils/privacy";

Page({
  leaveCurrentInteraction() {
    // This only moves the customer away from the current surface. It does not
    // cancel an order, create a report, or write any safety-related record.
    wx.switchTab({ url: "/pages/discover/index" });
  },
  openMessages() {
    wx.switchTab({ url: "/pages/messages/index" });
  },
  openOrders() {
    wx.switchTab({ url: "/pages/orders/index" });
  },
  openPrivacy() {
    openLegalDocument("privacy");
  },
  openTerms() {
    openLegalDocument("terms");
  }
});
