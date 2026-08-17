import { NextResponse, type NextRequest } from "next/server";

const securityHeaders = [
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

export function proxy(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://trystash.xyz`);
  for (const header of securityHeaders) response.headers.set(header.key, header.value);
  return response;
}

export const config = { matcher: "/:path*" };
