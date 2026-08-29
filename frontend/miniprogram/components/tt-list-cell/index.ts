Component({
  options: { multipleSlots: true },
  properties: {
    title: { type: String, value: "" },
    subtitle: { type: String, value: "" },
    meta: { type: String, value: "" },
    arrow: { type: Boolean, value: true },
    disabled: { type: Boolean, value: false }
  },
  methods: { onTap() { if (!this.data.disabled) this.triggerEvent("tap"); } }
});
