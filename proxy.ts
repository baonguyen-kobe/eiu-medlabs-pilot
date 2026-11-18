import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { IMPORT_PATHS, importsEnabled } from "@/lib/feature-flags";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Imports are hidden for now (owner 2026-11-18); their pages go home.
  if (
    !importsEnabled() &&
    IMPORT_PATHS.some(
      (path) => pathname === path || pathname.startsWith(path + "/"),
    )
  ) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
