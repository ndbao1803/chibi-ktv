import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { cookieFrom, startTestApp } from './helpers.js';

describe('Login (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ({ app } = await startTestApp());
    http = request(app.getHttpServer());
  });
  afterAll(async () => app.close());

  const minh = { email: 'Minh.Anh@example.com', password: 'hat-hay-qua-123', displayName: 'Minh Anh' };

  it('registers, sets an httpOnly cookie and lowercases the email', async () => {
    const res = await http.post('/api/auth/register').send(minh).expect(201);
    expect(res.body).toMatchObject({ email: 'minh.anh@example.com', displayName: 'Minh Anh' });
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
  });

  it('refuses a second account with the same email', async () => {
    const res = await http.post('/api/auth/register').send(minh).expect(409);
    expect(res.body.message).toBe('Email này đã có tài khoản');
  });

  it('rejects a short password with a readable message', async () => {
    const res = await http.post('/api/auth/register').send({ ...minh, email: 'x@example.com', password: '123' }).expect(400);
    expect(res.body.message).toBe('Mật khẩu cần ít nhất 8 ký tự');
  });

  it('logs in and "me" returns the account', async () => {
    const login = await http.post('/api/auth/login').send({ email: minh.email, password: minh.password }).expect(200);
    const me = await http.get('/api/auth/me').set('Cookie', cookieFrom(login)).expect(200);
    expect(me.body.displayName).toBe('Minh Anh');
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const a = await http.post('/api/auth/login').send({ email: minh.email, password: 'wrong-password' }).expect(401);
    const b = await http.post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever1' }).expect(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('blocks "me" without a cookie and with a forged cookie', async () => {
    await http.get('/api/auth/me').expect(401);
    await http.get('/api/auth/me').set('Cookie', 'ktv_token=forged.token.value').expect(401);
  });

  it('logout clears the cookie', async () => {
    const res = await http.post('/api/auth/logout').expect(204);
    expect(res.headers['set-cookie'][0]).toMatch(/ktv_token=;/);
  });

  it('health reports the database is up', async () => {
    const res = await http.get('/api/health').expect(200);
    expect(res.body.db).toBe('up');
  });
});
