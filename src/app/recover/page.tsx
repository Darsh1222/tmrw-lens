import { redirect } from "next/navigation";
import { Suspense } from "react";

/** Old links open the same integrated workspace, preserving recorded-example deep links. */
async function RecoveryRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const input = await searchParams,
    query = new URLSearchParams({ tab: "week" });
  for (const key of ["example", "view"]) if (typeof input[key] === "string") query.set(key, input[key]);
  redirect(`/?${query.toString()}`);
  return null;
}

export default function RecoveryPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<main className="workspace-loading">Opening your week…</main>}>
      <RecoveryRedirect {...props} />
    </Suspense>
  );
}
