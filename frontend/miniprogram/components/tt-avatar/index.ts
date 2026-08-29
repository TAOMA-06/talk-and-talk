Component({
  properties: {
    src: { type: String, value: "" },
    fallback: { type: String, value: "" },
    alt: { type: String, value: "人物头像" },
    size: { type: String, value: "md" },
    shape: { type: String, value: "circle" },
    online: { type: Boolean, value: false }
  },
  data: { failed: false },
  observers: {
    src() { this.setData({ failed: false }); }
  },
  methods: {
    onError() { this.setData({ failed: true }); }
  }
});
