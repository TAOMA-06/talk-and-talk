Component({
  options: { styleIsolation: "shared" },
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: "筛选" },
    summary: { type: String, value: "" },
    applyText: { type: String, value: "查看结果" },
    resetText: { type: String, value: "重置" }
  },
  methods: {
    close() { this.triggerEvent("close"); },
    apply() { this.triggerEvent("apply"); },
    reset() { this.triggerEvent("reset"); },
    noop() {}
  }
});
