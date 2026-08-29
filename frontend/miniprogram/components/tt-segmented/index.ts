Component({
  properties: { items: { type: Array, value: [] }, value: { type: String, value: "" } },
  methods: { choose(event: any) { this.triggerEvent("change", { value: event.currentTarget.dataset.value }); } }
});
