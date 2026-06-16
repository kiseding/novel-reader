import { SignJWT, jwtVerify } from "jose";

let _secret: Uint8Array | null = null;

export function setJwtSecret(secret: string) {
  _secret = new TextEncoder().encode(secret);
}

function getSecret(): Uint8Array {
  if (!_secret) throw new Error("JWT_SECRET 未初始化");
  return _secret;
}

export interface JwtPayload { userId: number; username: string; }

export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("7d").setIssuedAt().sign(getSecret());
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return { userId: payload.userId as number, username: payload.username as string };
  } catch { return null; }
}

export function extractToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  return parts.length === 2 && parts[0].toLowerCase() === "bearer" ? parts[1] : null;
}
