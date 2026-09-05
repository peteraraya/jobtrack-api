const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3456';
const RUN = Math.random().toString(36).slice(2);

// j() no adjunta Authorization salvo que se pase un header extra.
const j = (method, path, body, headers = {}) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({
    status: r.status,
    headers: r.headers,
    body: await r.json().catch(() => null),
  }));

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

// éxito viene envuelto en { data, meta }; los errores NO (Módulo 5).
const data = (body) => body?.data;

function assert(cond, label) {
  if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
  console.log(`  ok - ${label}`);
}

async function main() {
  // Health es público y reporta el ping a la base (envuelto en data/meta).
  const health = await j('GET', '/health');
  assert(health.status === 200 && data(health.body)?.details.database.status === 'up', 'health con ping a Postgres');

  const reqId = health.headers?.get('x-request-id');
  assert(reqId, 'responde con header x-request-id');

  /* ─── Auth ─── */
  const email = `smoke-${RUN}@jobtrack.dev`;
  const reg = await j('POST', '/v1/auth/register', { email, password: 'SmokePass!1' });
  assert(reg.status === 201 && data(reg.body)?.accessToken && data(reg.body)?.refreshToken, 'registro emite access + refresh');

  const me = await j('GET', '/v1/auth/me', null, bearer(data(reg.body).accessToken));
  assert(me.status === 200 && data(me.body)?.id === data(reg.body).user.id, 'GET /auth/me con token');

  const meUnauth = await j('GET', '/v1/auth/me');
  assert(meUnauth.status === 401, 'GET /auth/me sin token → 401');

  // Login del admin del seed (requiere haber corrido db:seed).
  const adminLogin = await j('POST', '/v1/auth/login', { email: 'admin@jobtrack.dev', password: 'Admin1234!' });
  assert(adminLogin.status === 201, 'login del admin seed (Admin1234!)');

  // Rotation: el refresh usado queda invalidado.
  const rotated = await j('POST', '/v1/auth/refresh', { refreshToken: data(reg.body).refreshToken });
  assert(rotated.status === 201 && data(rotated.body).refreshToken !== data(reg.body).refreshToken, 'refresh rota el token');
  const reused = await j('POST', '/v1/auth/refresh', { refreshToken: data(reg.body).refreshToken });
  assert(reused.status === 401, 'reutilizar el refresh ya rotado → 401');

  /* ─── RBAC: writes solo admin ─── */
  const companyNoAuth = await j('POST', '/v1/companies', { name: `Smoke Co ${RUN}` });
  assert(companyNoAuth.status === 401, 'POST /companies sin token → 401');

  const companyAsUser = await j('POST', '/v1/companies', { name: `Smoke Co ${RUN}` }, bearer(data(reg.body).accessToken));
  assert(companyAsUser.status === 403, 'POST /companies con usuario común → 403');

  const company = await j(
    'POST',
    '/v1/companies',
    { name: `Smoke Co ${RUN}`, location: 'Santiago' },
    bearer(data(adminLogin.body).accessToken),
  );
  assert(company.status === 201, 'POST /companies con admin → 201');

  const o1 = await j(
    'POST',
    '/v1/job-offers',
    { companyId: data(company.body).id, title: `Smoke One ${RUN}`, sourceUrl: `https://smoke.dev/o1-${RUN}` },
    bearer(data(adminLogin.body).accessToken),
  );
  const o2 = await j(
    'POST',
    '/v1/job-offers',
    { companyId: data(company.body).id, title: `Smoke Two ${RUN}`, sourceUrl: `https://smoke.dev/o2-${RUN}` },
    bearer(data(adminLogin.body).accessToken),
  );
  assert(o1.status === 201 && o2.status === 201, 'crear 2 ofertas (admin)');
  assert(data(o1.body).slots === 3 && data(o1.body).source === 'manual', 'slots default 3 y source manual');

  const cat = await j('GET', '/v1/job-offers');
  assert(cat.status === 200 && data(cat.body)?.items.length > 0, 'catálogo de ofertas público');

  /* ─── Applications: userId del token + scope por usuario ─── */
  const apply = await j('POST', '/v1/applications', { jobOfferId: data(o1.body).id }, bearer(data(reg.body).accessToken));
  assert(apply.status === 201 && data(apply.body).userId === data(reg.body).user.id, 'POST /applications usa userId del TOKEN');

  const myApps = await j('GET', '/v1/applications', null, bearer(data(reg.body).accessToken));
  assert(
    myApps.status === 200 && data(myApps.body).length === 1 && data(myApps.body)[0].jobOfferId === data(o1.body).id,
    'GET /applications scope: solo las mías',
  );

  const patch = await j('PATCH', `/v1/applications/${data(apply.body).id}`, { status: 'interview' }, bearer(data(reg.body).accessToken));
  assert(patch.status === 200 && data(patch.body).status === 'interview', 'dueño cambia su propio estado');

  const notFound = await j('GET', `/v1/companies/${'00000000-0000-4000-8000-000000000000'}`);
  assert(notFound.status === 404, '404 para id inexistente');

  const bad = await j(
    'POST',
    '/v1/job-offers',
    { companyId: data(company.body).id, title: 'X', sourceUrl: 'nope' },
    bearer(data(adminLogin.body).accessToken),
  );
  assert(bad.status === 400, '400 para fuente inválida');

  const page1 = await j('GET', '/v1/job-offers?limit=1');
  assert(page1.status === 200 && data(page1.body).items.length === 1 && data(page1.body).nextCursor, 'página 1 con nextCursor');
  const page2 = await j('GET', `/v1/job-offers?limit=1&cursor=${encodeURIComponent(data(page1.body).nextCursor)}`);
  assert(
    page2.status === 200 && data(page2.body).items.length === 1 && data(page2.body).items[0].id !== data(page1.body).items[0].id,
    'página 2 distinta, sin repetir la anterior',
  );

  const duplicatedOffer = await j(
    'POST',
    '/v1/job-offers',
    { companyId: data(company.body).id, title: `Copy ${RUN}`, sourceUrl: `https://smoke.dev/o1-${RUN}` },
    bearer(data(adminLogin.body).accessToken),
  );
  assert(duplicatedOffer.status === 409, '409 por sourceUrl única');

  console.log('SMOKE OK');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});