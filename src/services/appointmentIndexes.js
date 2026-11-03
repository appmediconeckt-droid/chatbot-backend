export const REQUIRED_BOOKING_INDEXES = [
  { name: "active_counselor_start", key: { counselor: 1, date: 1 }, unique: true, partialFilterExpression: { status: { $in: ["pending", "confirmed"] } } },
  { name: "active_patient_start", key: { patient: 1, date: 1 }, unique: true, partialFilterExpression: { status: { $in: ["pending", "confirmed"] } } },
  { name: "booking_request_key", key: { patient: 1, requestKey: 1 }, unique: true, partialFilterExpression: { requestKey: { $type: "string" } } },
];
export const bookingIndexesReady = indexes => REQUIRED_BOOKING_INDEXES.every(required => indexes.some(index =>
  index.name === required.name && index.unique === true && JSON.stringify(index.key) === JSON.stringify(required.key) &&
  JSON.stringify(index.partialFilterExpression) === JSON.stringify(required.partialFilterExpression)));
