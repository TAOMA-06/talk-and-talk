import { initializeBackend, installNetworkRecovery } from "./utils/api";

App({
  onLaunch() {
    initializeBackend();
    installNetworkRecovery();
  },
  globalData: {
    appName: "Talk&Talk",
    discoveryIntent: null
  }
});
