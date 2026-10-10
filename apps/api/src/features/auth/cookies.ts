import type { FastifyReply } from "fastify";
import { config } from "@nerloq/config";

export const ACCESS_COOKIE = "nerloq_access";
export const REFRESH_COOKIE = "nerloq_refresh";

export function durationSeconds(value: string, fallback: number): number {
  const match = /^(\d+)(s|m|h|d)$/i.exec(value);
  if (!match) return fallback;
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const multiplier = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
  return amount * multiplier;
}

export function durationMilliseconds(value: string, fallback: number): number {
  return durationSeconds(value, Math.ceil(fallback / 1000)) * 1000;
}

function baseCookieOptions(path: string) {
  return {
    path,
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  } as const;
}

export function setSessionCookies(reply: FastifyReply, accessToken: string, refreshToken: string): void {
  reply.setCookie(ACCESS_COOKIE, accessToken, {
    ...baseCookieOptions("/"),
    maxAge: durationSeconds(config.JWT_ACCESS_EXPIRES_IN, 900),
  });
  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookieOptions("/api/v1/auth"),
    maxAge: durationSeconds(config.JWT_REFRESH_EXPIRES_IN, Math.ceil(config.SESSION_IDLE_TIMEOUT_MS / 1000)),
  });
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, baseCookieOptions("/"));
  reply.clearCookie(REFRESH_COOKIE, baseCookieOptions("/api/v1/auth"));
}
