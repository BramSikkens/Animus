import { NextResponse, type NextRequest } from "next/server";

// #108: het dashboard heeft geen authenticatie en bindt enkel op 127.0.0.1. Deze Host-controle weert daarbovenop
// DNS-rebinding: een kwaadaardige site die naar 127.0.0.1 resolvet, stuurt haar eigen hostnaam mee als Host.
const ALLOWED_HOSTS = new Set(["localhost:3001", "127.0.0.1:3001"]);

export function proxy(request: NextRequest): NextResponse {
  if (!ALLOWED_HOSTS.has(request.headers.get("host") ?? "")) return new NextResponse("Verboden host", { status: 403 });
  return NextResponse.next();
}
