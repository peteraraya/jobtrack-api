import 'dotenv/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { AppModule } from './src/app.module.js';
import { configureApp } from './src/configure-app.js';

async function main() {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  configureApp(app);
  await app.init();
  await app.get(DataSource).synchronize(true);

  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Password123!';

  const reg = await http()
    .post('/auth/register')
    .send({ email: `dbg-${crypto.randomUUID()}@jobtrack.dev`, password: PASSWORD })
    .expect(201);
  const u = reg.body;

  const dump = async (label) => {
    const row = await app
      .get(DataSource)
      .query(`SELECT "refreshTokenHash" FROM "user" WHERE "id" = $1`, [u.user.id]);
    console.log(`${label} stored_len=${row[0]?.refreshTokenHash?.length ?? 0}`);
  };

  await dump('after register ');
  const first = await http()
    .post('/auth/refresh')
    .send({ refreshToken: u.refreshToken })
    .expect(201);
  console.log('after refresh  tokens_differ =', first.body.refreshToken !== u.refreshToken);
  await dump('after refresh ');

  const row = await app
    .get(DataSource)
    .query(`SELECT "refreshTokenHash" FROM "user" WHERE "id" = $1`, [u.user.id]);
  const stored = row[0].refreshTokenHash;
  console.log('compare(original, stored) =', await compare(u.refreshToken, stored));
  console.log('compare(new, stored)      =', await compare(first.body.refreshToken, stored));

  await app.close();
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});