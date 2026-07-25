type OrderAcceptanceSnapshot = {
  id: string;
  companionConfirmedAt?: Date | string | null;
};

/**
 * A live confirmation timestamp can be cleared when an unpaid reservation
 * expires. Executive and attribution metrics therefore combine the current
 * snapshot with the immutable audit fact written in the confirmation
 * transaction. Keeping this rule in one place prevents two dashboards from
 * assigning different meanings to "accepted".
 */
export async function loadAcceptedOrderIds(
  database: {
    auditLog: {
      findMany(input: unknown): Promise<Array<{ resourceId: string | null }>>;
    };
  },
  orders: OrderAcceptanceSnapshot[]
): Promise<Set<string>> {
  const orderIds = [...new Set(orders.map((order) => order.id).filter(Boolean))];
  const acceptedOrderIds = new Set(
    orders.filter((order) => Boolean(order.companionConfirmedAt)).map((order) => order.id)
  );
  if (orderIds.length === 0) return acceptedOrderIds;

  const rows = await database.auditLog.findMany({
    where: {
      action: "order.companion_confirmed",
      resourceType: "order",
      resourceId: { in: orderIds }
    },
    select: { resourceId: true },
    distinct: ["resourceId"]
  });
  for (const row of rows) {
    if (row.resourceId) acceptedOrderIds.add(row.resourceId);
  }
  return acceptedOrderIds;
}
