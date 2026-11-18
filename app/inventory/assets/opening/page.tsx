import { redirect } from "next/navigation";

// t2f: one intake page per task; the asset form lives behind ?kind=asset.
export default function LegacyAssetIntakePage() {
  redirect("/inventory/opening?kind=asset");
}
