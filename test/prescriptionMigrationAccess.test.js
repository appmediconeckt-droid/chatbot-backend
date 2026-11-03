import { expect } from 'chai';
import sinon from 'sinon';
import Prescription from '../src/models/Prescription.js';
import { canReadPrivateAsset } from '../src/services/privateAssets.js';

describe('Prepared prescription snapshot migration access', () => {
  const asset = { _id: 'asset', ownerId: 'issuer', purpose: 'prescription', prescriptionId: 'rx' };
  let record;
  beforeEach(() => {
    record = { psychiatristId: 'issuer', patientId: 'patient', identityVerification: { status: 'verified' }, psychiatristSnapshot: { prescriptionSignature: '/api/private-files/asset' } };
    sinon.stub(Prescription, 'findById').callsFake(async () => record);
  });
  afterEach(() => sinon.restore());
  it('allows the verified patient and original issuer', async () => {
    expect(await canReadPrivateAsset(asset, { _id: 'patient', role: 'user' })).to.equal(true);
    expect(await canReadPrivateAsset(asset, { _id: 'issuer', role: 'counsellor' })).to.equal(true);
  });
  it('denies outsiders and role substitution including generic admin', async () => {
    for (const user of [{ _id: 'outsider', role: 'user' }, { _id: 'patient', role: 'counsellor' }, { _id: 'admin', role: 'admin' }]) expect(await canReadPrivateAsset(asset, user)).to.equal(false);
  });
  it('preserves the patient verification gate while issuer can recover', async () => {
    record.identityVerification.status = 'pending';
    expect(await canReadPrivateAsset(asset, { _id: 'patient', role: 'user' })).to.equal(false);
    expect(await canReadPrivateAsset(asset, { _id: 'issuer', role: 'counsellor' })).to.equal(true);
  });
  it('denies missing records, detached snapshots and mismatched storage owner', async () => {
    const user = { _id: 'issuer', role: 'counsellor' };
    record.psychiatristSnapshot = {}; expect(await canReadPrivateAsset(asset, user)).to.equal(false);
    record.psychiatristSnapshot.prescriptionSignature = '/api/private-files/asset'; record.psychiatristId = 'other'; expect(await canReadPrivateAsset(asset, user)).to.equal(false);
    record = null; expect(await canReadPrivateAsset(asset, user)).to.equal(false);
  });
  it('denies purpose mismatch and never treats PDF-only references as snapshots', async () => {
    expect(await canReadPrivateAsset({ ...asset, purpose: 'chat' }, { _id: 'issuer', role: 'counsellor' })).to.equal(false);
    record.psychiatristSnapshot = {}; record.pdf = { url: '/api/private-files/asset' };
    expect(await canReadPrivateAsset(asset, { _id: 'patient', role: 'user' })).to.equal(false);
  });
  it('retains existing unbound professional-asset access', async () => {
    expect(await canReadPrivateAsset({ _id: 'old', ownerId: 'issuer', purpose: 'prescription' }, { _id: 'issuer', role: 'counsellor' })).to.equal(true);
    expect(Prescription.findById.called).to.equal(false);
  });
});
