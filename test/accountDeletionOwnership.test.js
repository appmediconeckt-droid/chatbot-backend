import { expect } from 'chai';
import mongoose from 'mongoose';
import sift from 'sift';
import { prescriptionAccountOwnershipFilter } from '../src/services/accountDeletionOwnership.js';

describe('Account deletion clinical ownership', () => {
  const owner = new mongoose.Types.ObjectId(), other = new mongoose.Types.ObjectId();
  it('preserves another patient record when the departing account only reviewed identity', () => {
    const records = [
      { patientId: other, psychiatristId: other, identityVerification: { reviewedBy: owner } },
      { patientId: owner, psychiatristId: other },
      { patientId: other, psychiatristId: owner },
    ];
    const selected = records.filter(sift(prescriptionAccountOwnershipFilter(owner)));
    expect(selected).to.deep.equal(records.slice(1));
  });
  it('only includes linked account conversations when matching by chat', () => {
    const chat = new mongoose.Types.ObjectId();
    const unrelated = { patientId: other, psychiatristId: other, chatId: new mongoose.Types.ObjectId() };
    const owned = { ...unrelated, chatId: chat };
    expect([unrelated, owned].filter(sift(prescriptionAccountOwnershipFilter(owner, [chat])))).to.deep.equal([owned]);
  });
});
