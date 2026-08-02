function configuredValue(value: string | undefined) {
  return value?.trim() || "";
}

/** Public, optional service-entry configuration for the official site. */
export const miniprogramQrUrl = configuredValue(process.env.NEXT_PUBLIC_MINIPROGRAM_QR_URL);
export const miniprogramEntryUrl = configuredValue(process.env.NEXT_PUBLIC_MINIPROGRAM_PATH);
