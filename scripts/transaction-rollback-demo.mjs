// Módulo 10 — demo: SIGTERM a mitad de una transacción.
//
//   node scripts/transaction-rollback-demo.mjs run                       → hace el demo
//   node scripts/transaction-rollback-demo.mjs run --marker mmm          → con marcador fijo
//   node scripts/transaction-rollback-demo.mjs verify <marcador>         → verifica el resultado
//
// Qué muestra:
//   1) Un COMMIT hecho a tiempo SOBREVIVE al SIGTERM.
//   2) Una transacción abierta al recibir SIGTERM (sin COMMIT) es REVERTIDA
//      por Postgres cuando la conexión se cierra: el work in progress no
//      queda a medio escribir. Es el comportamiento que la app aplica en
//      producción: enableShutdownHooks cierra Postgres (TypeOrmCoreModule),
//      las colas (BullExplorer) y los clientes Redis de forma ordenada.
import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const CONNECTION_STRING = process.env.DATABASE_URL;

function fail(message) {
  console.error(`\nFAIL: ${message}`);
  process.exit(1);
}

// Ids estables derivados del marcador: la corrida `verify` en un proceso nuevo
// puede recomponer los MISMOs ids de la corrida `run`.
function deriveUuid(seed) {
  const hex = createHash('sha1').update(seed).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${'8' + hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function parseFlags(argv) {
  const args = [...argv];
  const markerIndex = args.indexOf('--marker');
  const marker =
    markerIndex !== -1 ? args[markerIndex + 1] : randomUUID();
  return { marker };
}

async function runDemo() {
  if (!CONNECTION_STRING) fail('DATABASE_URL no está en .env');

  const { marker } = parseFlags(process.argv.slice(2));
  const committedId = deriveUuid(`commit:${marker}`);
  const abortedId = deriveUuid(`abort:${marker}`);

  const pool = new Pool({ connectionString: CONNECTION_STRING });
  const client = await pool.connect();

  console.log(`\nDemo con marcador: ${marker}`);
  console.log('  verify: node scripts/transaction-rollback-demo.mjs verify ' + marker);
  console.log('conexión abierta. BEGIN;');

  await client.query('BEGIN');

  // 1) Transacción completada ANTES del SIGTERM: se persiste.
  await client.query('INSERT INTO company (id, name) VALUES ($1, $2)', [
    committedId,
    `commit-demo-${marker}`,
  ]);
  await client.query('COMMIT');
  console.log('INSERT (commit-demo) + COMMIT → fila persistida.');

  // 2) Transacción ABIERTA al recibir SIGTERM: el proceso la deja sin COMMIT.
  await client.query('BEGIN');
  await client.query('INSERT INTO company (id, name) VALUES ($1, $2)', [
    abortedId,
    `abort-demo-${marker}`,
  ]);
  console.log('INSERT (abort-demo) hecho pero SIN COMMIT todavía.');
  console.log('disparando SIGTERM a mitad de la transacción...\n');

  // Graceful shutdown: el hook de la app cierra la conexión con la tx abierta.
  process.on('SIGTERM', () => {
    console.log('[shutdown] cerrando conexión con la transacción abierta...');
    client.release(true); // cierra la conexión → Postgres revierte la tx
    void pool.end().then(() => {
      console.log('[shutdown] pool cerrado. Saliendo con estado 0.\n');
      process.exit(0);
    });
  });

  process.kill(process.pid, 'SIGTERM');
}

async function verify([markerArg]) {
  if (!CONNECTION_STRING) fail('DATABASE_URL no está en .env');
  if (!markerArg) {
    fail('necesitás el marcador: node scripts/transaction-rollback-demo.mjs verify <marcador>');
  }

  const committedId = deriveUuid(`commit:${markerArg}`);
  const abortedId = deriveUuid(`abort:${markerArg}`);
  const pool = new Pool({ connectionString: CONNECTION_STRING });
  const committed = await pool.query('SELECT 1 FROM company WHERE id = $1', [
    committedId,
  ]);
  const aborted = await pool.query('SELECT 1 FROM company WHERE id = $1', [
    abortedId,
  ]);
  await pool.end();

  console.log(`\nVerificando marcador ${markerArg}`);
  console.log(
    `  commit-demo (COMMIT antes del SIGTERM): ${committed.rowCount === 1 ? 'persistida ✓' : 'NO está ✗'}`,
  );
  console.log(
    `  abort-demo (tx abierta al SIGTERM):   ${aborted.rowCount === 0 ? 'revertida ✓ (no quedó estado a medio escribir)' : 'SI está ✗'}`,
  );

  if (committed.rowCount !== 1 || aborted.rowCount !== 0) {
    fail('verificación inconsistente');
  }
  console.log('Rollback atómico de PostgreSQL verificado ✅\n');
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'run') {
  await runDemo();
} else if (mode === 'verify') {
  await verify(rest);
} else {
  fail('usá: run [--marker <marcador>] | verify <marcador>');
}