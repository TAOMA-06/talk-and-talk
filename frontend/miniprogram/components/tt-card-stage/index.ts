Component({
  options: { multipleSlots: true },
  properties: {
    layout: { type: String, value: "stack" },
    minHeight: { type: Number, value: 360 },
    motionLevel: { type: String, value: "m1" },
    entrance: { type: String, value: "none" },
    active: { type: Boolean, value: false },
    motionOff: { type: Boolean, value: false },
    risk: { type: String, value: "high" },
    ariaLabel: { type: String, value: "卡片组合" }
  }
});
