import { notFound } from "next/navigation";
import { NextResponse } from "next/server";

import { dispositionForPath } from "./web-surface-policy";
import { errorEnvelope } from "./server-api";

/** Server Component gate for deferred or private page routes. */
export function enforcePageSurface(pathname: string): void {
  const disposition = dispositionForPath(pathname);
  if (disposition === "allow") return;
  notFound();
}

/** Route Handler gate for BFF / session APIs. */
export function enforceApiSurface(pathname: string): NextResponse | null {
  const disposition = dispositionForPath(pathname);
  if (disposition === "allow") return null;
  return NextResponse.json(
    errorEnvelope(
      "ROUTE_NOT_ALLOWED",
      "该接口仅供隔离开发联调使用，官网生产候选默认禁用",
    ),
    { status: 403 },
  );
}
