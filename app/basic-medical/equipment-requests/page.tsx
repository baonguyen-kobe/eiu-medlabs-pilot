import { redirect } from "next/navigation";

// t4e: Basic Medical registration lives on the shared Đăng ký thiết bị
// screen; old links, forms and emails keep working through this redirect.
export default async function BasicMedicalEquipmentRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams({ scope: "basic_medical" });
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string" && key !== "scope") params.set(key, value);
  }
  redirect(`/equipment/register?${params}`);
}
