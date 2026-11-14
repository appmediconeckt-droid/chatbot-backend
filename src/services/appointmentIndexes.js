export const REQUIRED_BOOKING_INDEXES = [
  { name: "active_counselor_start", key: { counselor: 1, date: 1 }, unique: true, partialFilterExpression: { status: { $in: ["pending", "confirmed"] } } },
  { name: "active_patient_start", key: { patient: 1, date: 1 }, unique: true, partialFilterExpression: { status: { $in: ["pending", "confirmed"] } } },
  { name: "booking_request_key", key: { patient: 1, requestKey: 1 }, unique: true, partialFilterExpression: { requestKey: { $type: "string" } } },
];
// Compound-key order is significant. Predicate object order and $in ordering
// are not; MongoDB may return an equivalent predicate in canonical order.
const canonicalPredicate = value => {
  if (Array.isArray(value)) return value.map(canonicalPredicate);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key,
    key === "$in" && Array.isArray(value[key])
      ? [...value[key]].sort()
      : canonicalPredicate(value[key]),
  ]));
};
export const bookingIndexesReady = (indexes, requiredIndexes = REQUIRED_BOOKING_INDEXES) => requiredIndexes.every(required => indexes.some(index =>
  index.name === required.name && index.unique === true && JSON.stringify(index.key) === JSON.stringify(required.key) &&
  JSON.stringify(canonicalPredicate(index.partialFilterExpression)) === JSON.stringify(canonicalPredicate(required.partialFilterExpression))));
