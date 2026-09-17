/** Conservative byte-safe limit for a reliably scannable displayed QR code. */
export const MAX_QR_CODE_PAYLOAD_LENGTH = 2000;

export const isQrCodePayloadSafe = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_QR_CODE_PAYLOAD_LENGTH;
