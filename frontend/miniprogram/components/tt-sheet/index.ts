Component({
  options: { multipleSlots: true, styleIsolation: "shared" },
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: "" },
    subtitle: { type: String, value: "" },
    closable: { type: Boolean, value: true },
    maskClosable: { type: Boolean, value: true },
    motionLevel: { type: String, value: "m1" },
    motionOff: { type: Boolean, value: false }
  },
  methods: {
    close() { if (this.data.closable) this.triggerEvent("close"); },
    closeMask() { if (this.data.maskClosable) this.triggerEvent("close"); },
    noop() {}
  }
});
