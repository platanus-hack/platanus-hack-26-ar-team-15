import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStepUpServiceAuth } from "@/lib/step-up/service-auth";
import { getSharedKernelRuntime } from "@/src/runtime/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/elevenlabs/decision
//
// ElevenLabs server tools (`approve_action` / `deny_action`) configured in
// the agent dashboard POST here when the user gives a verbal yes/no during
// the voice biometric step-up.
//
// On deny: cancel the pending step-up so the runtime emits step_up.canceled
// and the UI lights red.
// On approve: we don't auto-complete the step-up because the demo uses a
// two-factor flow (voice + passkey) — voice signals intent, passkey
// confirms identity. We emit a voice.message event so the activity feed
// shows the verbal "sí" alongside the upcoming passkey prompt. The actual
// completion happens via /api/step-up/passkey/finish.

const bodySchema = z.object({
  challenge_id: z.string(),
  decision: z.enum(["approve", "deny"]),
  reason: z
    .enum(["user_denied", "duress", "silence", "out_of_scope"])
    .optional()
});

const kernelRuntime = getSharedKernelRuntime();

export async function POST(req: Request) {
  const auth = requireStepUpServiceAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_body",
        detail: err instanceof Error ? err.message : String(err)
      },
      { status: 400 }
    );
  }

  const pending = await kernelRuntime.getPendingStepUp(payload.challenge_id);
  if (!pending) {
    return NextResponse.json(
      { ok: false, error: "challenge_not_found" },
      { status: 404 }
    );
  }
  if (pending.status !== "pending") {
    return NextResponse.json(
      { ok: false, error: `challenge_status_${pending.status}` },
      { status: 410 }
    );
  }

  if (payload.decision === "deny") {
    const username = pending.challengeOwnerUsername ?? "voice_agent";
    try {
      await kernelRuntime.cancelPendingStepUp(payload.challenge_id, username);
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          error: "cancel_failed",
          detail: err instanceof Error ? err.message : String(err)
        },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      next: "denied",
      challengeId: payload.challenge_id,
      reason: payload.reason ?? "user_denied"
    });
  }

  // Approve path — emit two events:
  //
  // 1. voice.message: human-readable trace for the activity feed.
  // 2. step_up.phone_confirmed: machine signal that the dashboard can
  //    listen for to AUTO-TRIGGER the passkey prompt. Without this,
  //    the user has to click a button after Melisa hangs up. With it,
  //    the WebAuthn dialog pops up automatically and the user just
  //    does Touch ID / Face ID — single biometric per scenario, voice
  //    pre-confirms intent, passkey signs the actual broadcast.
  //
  // We emit phone_confirmed as a pure event here (no kernel state
  // mutation) because the canonical flow uses requiredStepUp=passkey
  // and confirmPhoneStepUp() asserts channel=voice_biometric_callback.
  // The state still advances normally via /api/step-up/passkey/finish.
  const now = Date.now();
  kernelRuntime.emit({
    type: "voice.message",
    ts: now,
    requestId: pending.requestId,
    role: "user",
    text: "(voice approve received — awaiting passkey)"
  });
  kernelRuntime.emit({
    type: "step_up.phone_confirmed",
    ts: now,
    requestId: pending.requestId,
    challengeId: payload.challenge_id,
    channel: pending.channel,
    provider: "elevenlabs"
  });

  return NextResponse.json({
    ok: true,
    next: "awaiting_passkey",
    challengeId: payload.challenge_id
  });
}

// GET — debug peek at a challenge's current status.
export async function GET(req: Request) {
  const auth = requireStepUpServiceAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  const challengeId = url.searchParams.get("challengeId");
  if (!challengeId) {
    return NextResponse.json(
      { ok: false, error: "missing_challengeId" },
      { status: 400 }
    );
  }
  const pending = await kernelRuntime.getPendingStepUp(challengeId);
  if (!pending) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 }
    );
  }
  return NextResponse.json({
    ok: true,
    challenge: {
      challengeId: pending.challengeId,
      requestId: pending.requestId,
      status: pending.status,
      channel: pending.channel,
      expiresAt: pending.expiresAt
    }
  });
}
