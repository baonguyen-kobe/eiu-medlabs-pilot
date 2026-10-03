import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const releaseSchema = z.object({
  request_id: z.guid(),
  lock_token: z.guid(),
  retry_key: z.guid(),
});

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json({ error: "AUTH_DENIED" }, { status: 403 });
  const text = await request.text();
  if (text.length > 4096)
    return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 413 });
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 400 });
  }
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 400 });
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims.sub)
    return NextResponse.json({ error: "AUTH_DENIED" }, { status: 401 });
  const { error } = await supabase.rpc("equipment_preparation_command", {
    p_operation: "release_lock",
    p_request_id: parsed.data.request_id,
    p_payload: { lock_token: parsed.data.lock_token },
    p_retry_key: parsed.data.retry_key,
  });
  if (error)
    return NextResponse.json(
      { error: "LOCK_NOT_RELEASED" },
      { status: error.code === "42501" ? 403 : 409 },
    );
  return new NextResponse(null, { status: 204 });
}
