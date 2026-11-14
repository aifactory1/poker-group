'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ROUNDS = 10;

function hashPassword(plain) {
  return bcrypt.hashSync(String(plain), ROUNDS);
}

function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compareSync(String(plain), String(hash));
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function randomPassword(length = 16) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%';
  const buf = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

module.exports = { hashPassword, verifyPassword, randomToken, randomPassword };
