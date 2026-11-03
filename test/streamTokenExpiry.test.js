import { expect } from 'chai';
import sinon from 'sinon';
import { StreamChat } from 'stream-chat';
import jwt from 'jsonwebtoken';
import { createStreamUserToken, createStreamCallToken } from '../src/services/streamService.js';

it('issues an expiring Stream credential scoped to the authenticated user', () => {
  const saved = [process.env.STREAM_API_KEY, process.env.STREAM_API_SECRET];
  process.env.STREAM_API_KEY = 'isolated-stream-key';
  process.env.STREAM_API_SECRET = 'isolated-stream-secret';
  const createToken = sinon.stub().returns('synthetic-token');
  const stub = sinon.stub(StreamChat, 'getInstance').returns({ createToken });
  const clock = sinon.useFakeTimers({ now: 1800000000000 });
  try {
    expect(createStreamUserToken('fixture-user')).to.equal('synthetic-token');
    expect(createToken.firstCall.args).to.deep.equal(['fixture-user', 1800003600, 1800000000]);
  } finally {
    clock.restore(); stub.restore();
    ['STREAM_API_KEY', 'STREAM_API_SECRET'].forEach((key, i) => saved[i] === undefined ? delete process.env[key] : process.env[key] = saved[i]);
  }
});

it('issues five-minute call membership tokens without granting admin roles', () => {
  const saved = process.env.STREAM_API_SECRET;
  process.env.STREAM_API_SECRET = 'isolated-call-secret';
  try {
    const claims = jwt.verify(createStreamCallToken('fixture-user', ['approved-call']), 'isolated-call-secret');
    expect(claims.user_id).to.equal('fixture-user');
    expect(claims.call_cids).to.deep.equal(['default:approved-call']);
    expect(claims.exp - claims.iat).to.equal(300);
    expect(claims).not.to.have.property('role');
    expect(() => createStreamCallToken('fixture-user', [])).to.throw();
  } finally {
    if (saved === undefined) delete process.env.STREAM_API_SECRET;
    else process.env.STREAM_API_SECRET = saved;
  }
});
