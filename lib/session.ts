import { cookies } from "next/headers";
import { hashToken } from "./password";
import { findUserBySession, type UserRecord } from "./store";

const COOKIE = "cc_session";

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE)?.value ?? null;
}

export async function getCurrentUser(): Promise<UserRecord | null> {
  const token = await readSessionToken();
  if (!token) return null;
  return findUserBySession(hashToken(token));
}

export function publicUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    hasOpenAIKey: Boolean(user.openaiKey || process.env.OPENAI_API_KEY),
    model: user.model,
  };
}

export function resolveOpenAIKey(user: UserRecord): string | null {
  return user.openaiKey || process.env.OPENAI_API_KEY || null;
}
