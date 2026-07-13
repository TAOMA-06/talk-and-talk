/** Requests the platform-managed privacy authorization when the current Mini Program configuration requires it. */
export function ensurePrivacyAuthorization(): Promise<void> {
  if (!wx.getPrivacySetting || !wx.requirePrivacyAuthorize) return Promise.resolve();
  return new Promise((resolve, reject) => {
    wx.getPrivacySetting({
      success: (setting: any) => {
        if (!setting.needAuthorization) {
          resolve();
          return;
        }
        wx.requirePrivacyAuthorize({ success: () => resolve(), fail: () => reject(new Error("需要同意隐私保护指引后才能继续")) });
      },
      fail: () => resolve()
    });
  });
}
