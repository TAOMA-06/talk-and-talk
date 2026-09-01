Component({
  properties: {
    type: { type: String, value: "empty" },
    title: { type: String, value: "" },
    description: { type: String, value: "" },
    actionText: { type: String, value: "" },
    busy: { type: Boolean, value: false },
    motionLevel: { type: String, value: "m0" },
    motionOff: { type: Boolean, value: false }
  },
  methods: { onAction() { this.triggerEvent("action"); } }
});
