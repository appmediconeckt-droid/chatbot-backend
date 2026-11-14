import { expect } from 'chai';
import { REQUIRED_BOOKING_INDEXES, bookingIndexesReady } from '../src/services/appointmentIndexes.js';
describe('Booking unique-index validation', () => {
 it('accepts equivalent MongoDB-canonicalized active status order', () => {
  const indexes=structuredClone(REQUIRED_BOOKING_INDEXES);
  for (const index of indexes) if(index.partialFilterExpression.status) index.partialFilterExpression.status.$in.reverse();
  expect(bookingIndexesReady(indexes)).to.equal(true);
 });
 it('still rejects missing, nonunique, wrong-key or overbroad indexes', () => {
  expect(bookingIndexesReady([])).to.equal(false);
  expect(bookingIndexesReady(REQUIRED_BOOKING_INDEXES.map(index=>({...index,unique:false})))).to.equal(false);
  const wrong=structuredClone(REQUIRED_BOOKING_INDEXES);wrong[0].key={patient:1,date:1};expect(bookingIndexesReady(wrong)).to.equal(false);
  const overbroad=structuredClone(REQUIRED_BOOKING_INDEXES);overbroad[0].partialFilterExpression.status.$in.push('canceled');expect(bookingIndexesReady(overbroad)).to.equal(false);
 });
});
