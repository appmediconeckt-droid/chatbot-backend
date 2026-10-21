import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import { generateAccessToken, generateRefreshToken } from '../src/utils/token.js';
describe('Production token lifetimes and rotation', () => {
 it('access tokens expire in 15 minutes', () => {
  const token = jwt.decode(generateAccessToken('user', 'session', 'user'));
  expect(token.exp - token.iat).to.equal(900);
 });
 it('refresh tokens expire and rotate uniquely even in the same second', () => {
  const first = generateRefreshToken('user', 'session', 'user');
  const second = generateRefreshToken('user', 'session', 'user');
  expect(first).not.to.equal(second);
  const token = jwt.decode(first);
  expect(token.exp - token.iat).to.equal(30 * 86400);
  expect(token.jti).to.be.a('string');
 });
});
