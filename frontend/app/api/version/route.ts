import probe from "../../../release-probe.json";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ application: "cloud", revision: process.env.APP_REVISION || "development", probe: probe.probe }, { headers: { "Cache-Control": "no-store" } });
}
