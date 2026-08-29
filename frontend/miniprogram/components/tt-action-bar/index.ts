Component({
  properties: {
    primaryText: { type: String, value: "继续" },
    secondaryText: { type: String, value: "" },
    disabled: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
    fixed: { type: Boolean, value: true }
  },
  methods: {
    primary() { if (!this.data.disabled && !this.data.loading) this.triggerEvent("primary"); },
    secondary() { this.triggerEvent("secondary"); }
  }
});
