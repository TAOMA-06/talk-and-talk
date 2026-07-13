import { initializeBackend } from "./utils/api";

App({
  onLaunch() {
    initializeBackend();
  },
  globalData: {
    appName: "Talk&Talk"
  }
});
