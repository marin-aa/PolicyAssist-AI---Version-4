import { env } from "cloudflare:workers";
import { DEFAULT_MODEL } from "@/lib/gemini";

export function GET() {
  return Response.json({ configured: Boolean((env as unknown as Record<string,string>).GEMINI_API_KEY || process.env.GEMINI_API_KEY), model: DEFAULT_MODEL }, { headers: { "Cache-Control": "no-store" } });
}
