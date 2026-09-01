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
    online: { type: Boolean, value: false },
    variant: { type: String, value: "list" },
    tone: { type: String, value: "surface" },
    selected: { type: Boolean, value: false },
    depth: { type: String, value: "flat" },
    motionLevel: { type: String, value: "m1" },
    entrance: { type: String, value: "none" },
    stagger: { type: Number, value: 0 },
    motionOff: { type: Boolean, value: false },
    risk: { type: String, value: "high" }
  },
  methods: { onTap() { this.triggerEvent("tap"); } }
});
