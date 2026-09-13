import { createECDH, ECDH, timingSafeEqual } from "node:crypto";

/** Pure validation, with no global web-push state and no secret-bearing errors. */
export function validVapidPair(publicKey: string, privateKey: string): boolean {
  try {
    const publicBytes = Buffer.from(publicKey, "base64url");
    const privateBytes = Buffer.from(privateKey, "base64url");
    if (
      publicBytes.length !== 65 ||
      publicBytes[0] !== 4 ||
      privateBytes.length !== 32 ||
      publicBytes.toString("base64url") !== publicKey ||
      privateBytes.toString("base64url") !== privateKey
    )
      return false;
    const validatedPublic = ECDH.convertKey(
      publicBytes,
      "prime256v1",
      undefined,
      undefined,
      "uncompressed",
    );
    const ec = createECDH("prime256v1");
    ec.setPrivateKey(privateBytes);
    return timingSafeEqual(ec.getPublicKey(), validatedPublic as Buffer);
  } catch {
    return false;
  }
}

export function validateVapidDetails(input: {
  publicKey: string;
  privateKey: string;
  subject: string;
}): void {
  let validSubject = false;
  try {
    validSubject = ["https:", "mailto:"].includes(
      new URL(input.subject).protocol,
    );
  } catch {
    /* Report only a fixed error below. */
  }
  if (!validSubject || !validVapidPair(input.publicKey, input.privateKey))
    throw new Error("Invalid VAPID credentials.");
}
