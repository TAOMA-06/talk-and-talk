Component({
  properties: {
    kind: { type: String, value: "bubble" },
    tone: { type: String, value: "blue" },
    size: { type: String, value: "md" },
    motion: { type: String, value: "none" },
    active: { type: Boolean, value: false },
    motionOff: { type: Boolean, value: false },
    expressive: { type: Boolean, value: false },
    risk: { type: String, value: "high" },
    decorative: { type: Boolean, value: true },
    ariaLabel: { type: String, value: "" }
  }
});
