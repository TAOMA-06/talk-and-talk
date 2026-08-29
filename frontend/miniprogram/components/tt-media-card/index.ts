Component({
  properties: {
    avatar: { type: String, value: "" },
    initials: { type: String, value: "" },
    title: { type: String, value: "" },
    subtitle: { type: String, value: "" },
    description: { type: String, value: "" },
    price: { type: String, value: "" },
    meta: { type: String, value: "" },
    badge: { type: String, value: "" },
    badgeTone: { type: String, value: "neutral" },
    online: { type: Boolean, value: false }
  },
  methods: { onTap() { this.triggerEvent("tap"); } }
});
