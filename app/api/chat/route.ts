import { NextRequest, NextResponse } from "next/server";
import { agent } from "@/lib/agent";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = body.message;

    const result = await agent.chat(message);

    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}