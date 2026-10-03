import assert from "node:assert/strict";

// Model the editor's persisted identities and optimistic revision, not legacy
// delete/reinsert payloads. Explicit IDs remain untouched for rejection tests.
export async function equipmentUpdateItems(client, requestId, items) {
  const { data: request, error } = await client
    .from("equipment_requests")
    .select(
      "preparation_revision,equipment_request_items(id,catalog_item_id,basic_medical_catalog_item_id,skill_name,removed_at)",
    )
    .eq("id", requestId)
    .single();
  assert.ifError(error);
  return items.map((item) => {
    const existing = request.equipment_request_items.find(
      (line) =>
        !line.removed_at &&
        (line.catalog_item_id ?? line.basic_medical_catalog_item_id) ===
          item.catalog_item_id &&
        (item.skill_name === undefined || line.skill_name === item.skill_name),
    );
    return {
      ...item,
      id: item.id ?? existing?.id,
      expected_revision: request.preparation_revision,
    };
  });
}
