Component({
  options: { multipleSlots: true },
  properties: {
    title: { type: String, value: "" },
    description: { type: String, value: "" },
    label: { type: String, value: "" },
    tone: { type: String, value: "blue" },
    selected: { type: Boolean, value: false },
    tilt: { type: String, value: "none" },
    depth: { type: String, value: "low" },
    motionLevel: { type: String, value: "m1" },
    entrance: { type: String, value: "none" },
    stagger: { type: Number, value: 0 },
    motionOff: { type: Boolean, value: false }
  },
  methods: { onTap() { this.triggerEvent("tap"); } }
});
