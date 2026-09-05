// Módulo 11 — entrypoint de contenedor.
//
// Decide qué proceso corre según APP_PROCESS:
//   api    (default) → corre las migraciones con reintento y arranca el API
//                      (`node dist/main.js` — HTTP + consumo de eventos Redis).
//   worker            → arranca el microservicio de scraping
//                      (`node dist/main-scraper.js`).
//
// Las migraciones son idempotentes pero REQUIEREN la BD: reintentamos un rato
// acotado en vez de chocar contra un healthcheck recién verde de Postgres.
import { spawn, spawnSync } from 'node:child_process';

const APP = process.env.APP_PROCESS ?? 'api';
const MIGRATION_MAX_TRIES = 30;
const MIGRATION_RETRY_DELAY_MS = 2000;

function runMigrations() {
  const args = [
    'node_modules/typeorm/cli.js',
    'migration:run',
    '-d',
    'dist/database/data-source.js',
  ];
  let attempt = 0;
  let result;
  while (attempt < MIGRATION_MAX_TRIES) {
    result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (result.status === 0) return true;
    attempt += 1;
    const wait = MIGRATION_RETRY_DELAY_MS;
    console.log(
      `[entry] migraciones fallaron (intento ${attempt}/${MIGRATION_MAX_TRIES}); reintentando en ${wait}ms`,
    );
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
  }
  console.error('[entry] no se pudieron aplicar las migraciones');
  return false;
}

const entryFor = {
  // api y worker corren las migraciones: son idempotentes y TypeORM las
  // serializa con advisory lock, así cualquiera de los dos puede ser el
  // primero en levantar contra una BD nueva sin condiciones de carrera.
  api: () => {
    if (!runMigrations()) process.exit(1);
    return 'dist/main.js';
  },
  worker: () => {
    if (!runMigrations()) process.exit(1);
    return 'dist/main-scraper.js';
  },
};

const entry = (entryFor[APP] ?? entryFor.api)();
const child = spawn(process.execPath, [entry], { stdio: 'inherit' });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[entry] reenviando ${signal} al proceso hijo`);
    child.kill(signal);
  });
}

child.on('exit', (code, signal) => {
  if (signal) {
    console.log(`[entry] proceso terminado por ${signal}`);
    process.exit(0);
  }
  process.exit(code ?? 1);
});