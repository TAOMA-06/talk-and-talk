Component({
  properties: {
    kicker: { type: String, value: "" },
    title: { type: String, value: "" },
    description: { type: String, value: "" },
    actionText: { type: String, value: "" },
    motionLevel: { type: String, value: "m1" },
    active: { type: Boolean, value: false },
    motionOff: { type: Boolean, value: false },
    risk: { type: String, value: "high" }
  },
  methods: { onAction() { this.triggerEvent("action"); } }
});
