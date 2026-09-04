const catalog = require("../../data/screens.js");

function boundedIndex(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 1;
  return Math.max(1, Math.min(catalog.screens.length, parsed));
}

Page({
  data: {
    screen: catalog.screens[0],
    hasPrevious: false,
    hasNext: catalog.screens.length > 1,
    total: catalog.screens.length
  },

  onLoad(options) {
    this.showIndex(boundedIndex(options.index));
  },

  showIndex(index) {
    const screen = catalog.screens[index - 1];
    this.setData({
      screen,
      hasPrevious: index > 1,
      hasNext: index < catalog.screens.length
    });
    wx.setNavigationBarTitle({ title: `${screen.number} · ${screen.title}` });
  },

  openLarge() {
    wx.previewImage({
      current: this.data.screen.image,
      urls: catalog.screens.map((screen) => screen.image)
    });
  },

  previous() {
    if (!this.data.hasPrevious) return;
    wx.redirectTo({ url: `/pages/screen/index?index=${this.data.screen.index - 1}` });
  },

  next() {
    if (!this.data.hasNext) return;
    wx.redirectTo({ url: `/pages/screen/index?index=${this.data.screen.index + 1}` });
  },

  backToGallery() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: "/pages/gallery/index" });
  }
});
