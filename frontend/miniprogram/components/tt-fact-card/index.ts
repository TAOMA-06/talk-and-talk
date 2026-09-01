Component({
  properties: {
    label: { type: String, value: "" },
    value: { type: String, value: "" },
    description: { type: String, value: "" },
    meta: { type: String, value: "" },
    tone: { type: String, value: "surface" },
    statusText: { type: String, value: "" },
    statusTone: { type: String, value: "neutral" },
    depth: { type: String, value: "flat" },
    motionLevel: { type: String, value: "m0" },
    entrance: { type: String, value: "none" },
    motionOff: { type: Boolean, value: false },
    risk: { type: String, value: "high" }
  }
});
