const catalog = require("../../data/screens.js");

Page({
  data: {
    groups: catalog.groups,
    activeGroup: "all",
    visibleScreens: catalog.screens,
    screenCount: catalog.screens.length
  },

  chooseGroup(event) {
    const group = String(event.currentTarget.dataset.group || "all");
    this.setData({
      activeGroup: group,
      visibleScreens: group === "all"
        ? catalog.screens
        : catalog.screens.filter((screen) => screen.group === group)
    });
  }
});
