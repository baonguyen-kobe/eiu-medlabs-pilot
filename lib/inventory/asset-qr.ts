import QRCode from "qrcode";

/**
 * Generates an SVG string representation of a standards-compliant QR code
 * encoding ONLY the bare asset_code (e.g. "EIU-AST-XXXXXXXX").
 *
 * Per S3 specification:
 * - QR encodes only asset_code, not serial/custody/cost/secrets/token or private URL.
 * - Server-side generated SVG.
 */
export async function generateAssetQrSvg(assetCode: string): Promise<string> {
  const code = assetCode.trim();
  if (!/^EIU-AST-[0-9A-F]{8}$/.test(code)) {
    throw new Error(
      "ASSET_QR_INVALID_CODE: Expected an institutional asset code",
    );
  }

  return QRCode.toString(code, {
    type: "svg",
    margin: 4,
    errorCorrectionLevel: "M",
    width: 200,
  });
}
