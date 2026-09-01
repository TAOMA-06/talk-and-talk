Component({
  properties: {
    avatar: { type: Boolean, value: true },
    rows: { type: Number, value: 3 },
    animated: { type: Boolean, value: true },
    motionOff: { type: Boolean, value: false }
  },
  data: { lineItems: [0, 1, 2] },
  observers: {
    rows(value: number) {
      const count = Math.max(1, Math.min(6, Number.isFinite(value) ? Math.floor(value) : 3));
      this.setData({ lineItems: Array.from({ length: count }, (_, index) => index) });
    }
  }
});
