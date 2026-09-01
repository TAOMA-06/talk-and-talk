Component({
  properties: {
    tone: { type: String, value: "surface" },
    size: { type: String, value: "standard" },
    interactive: { type: Boolean, value: false },
    selected: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    tilt: { type: String, value: "none" },
    depth: { type: String, value: "flat" },
    motionLevel: { type: String, value: "m1" },
    entrance: { type: String, value: "none" },
    stagger: { type: Number, value: 0 },
    motionOff: { type: Boolean, value: false },
    risk: { type: String, value: "high" },
    ariaLabel: { type: String, value: "" }
  },
  methods: {
    onTap() {
      if (this.data.interactive && !this.data.disabled) this.triggerEvent("tap");
    }
  }
});
