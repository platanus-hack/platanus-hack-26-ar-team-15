import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { SESSION_COOKIE, SESSION_PASSWORD } from "./config";

export interface SessionData {
  userId?: string;
  username?: string;
}

export const sessionOptions: SessionOptions = {
  password: SESSION_PASSWORD,
  cookieName: SESSION_COOKIE,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}
