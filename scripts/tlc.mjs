#!/usr/bin/env node

/**
 * Provision and run the pinned TLC model checker without committing its JAR.
 *
 * The official TLA+ release artifact is verified on every invocation, so the
 * local/GitHub cache is only a performance optimization and never a trust
 * boundary. Each run uses a dedicated metadata directory outside the
 * repository; successful runs remove it, while failed runs retain it for
 * local diagnosis.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const TLC = Object.freeze({
  version: '1.7.4',
  url: 'https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar',
  sha256: '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88',
});

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specsDir = path.join(rootDir, 'specs');
const cacheRoot = process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache');
const cacheDir = path.join(cacheRoot, 'videospeed', 'tlc');
const cachePath = path.join(cacheDir, `tla2tools-${TLC.version}-${TLC.sha256}.jar`);
const metadataRoot = path.join(cacheDir, 'runs');

function resolveOverride() {
  return process.env.TLC_JAR ? path.resolve(process.cwd(), process.env.TLC_JAR) : null;
}

async function sha256(file) {
  const hash = createHash('sha256');
  const handle = await fs.open(file, 'r');
  try {
    for await (const chunk of handle.createReadStream()) {
      hash.update(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

async function hasExpectedChecksum(file) {
  try {
    return (await sha256(file)) === TLC.sha256;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function downloadVerifiedJar(destination) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const temporaryPath = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      console.log(`Downloading TLC ${TLC.version} (attempt ${attempt}/3)…`);
      const response = await fetch(TLC.url);
      if (!response.ok || !response.body) {
        throw new Error(`TLC download failed: HTTP ${response.status} ${response.statusText}`);
      }

      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(temporaryPath, { mode: 0o600 })
      );
      if (!(await hasExpectedChecksum(temporaryPath))) {
        throw new Error(`TLC checksum mismatch for ${TLC.url}`);
      }

      await fs.rename(temporaryPath, destination);
      return;
    } catch (error) {
      lastError = error;
      await fs.rm(temporaryPath, { force: true });
    }
  }
  throw new Error(`Could not provision verified TLC ${TLC.version}: ${lastError.message}`);
}

async function resolveJar() {
  const override = resolveOverride();
  if (override) {
    if (!(await hasExpectedChecksum(override))) {
      throw new Error(
        `TLC_JAR must point to the pinned TLC ${TLC.version} artifact (SHA-256 ${TLC.sha256})`
      );
    }
    return override;
  }

  await fs.mkdir(cacheDir, { recursive: true });
  if (!(await hasExpectedChecksum(cachePath))) {
    await fs.rm(cachePath, { force: true });
    await downloadVerifiedJar(cachePath);
  }
  return cachePath;
}

async function run() {
  const jarPath = await resolveJar();
  await fs.mkdir(metadataRoot, { recursive: true });
  const metadataDir = await fs.mkdtemp(path.join(metadataRoot, 'run-'));
  console.log(`Running TLC ${TLC.version} with ${path.relative(rootDir, jarPath) || jarPath}`);

  try {
    const child = spawn(
      process.env.JAVA || 'java',
      [
        '-XX:+UseParallelGC',
        '-Xmx512m',
        '-jar',
        jarPath,
        '-workers',
        '1',
        // Keep TLC's fingerprint polynomial stable so repeated local/CI runs
        // explore the same state identity space and retain a low collision bound.
        '-fp',
        '1',
        '-metadir',
        metadataDir,
        '-config',
        'SpeedArbiter.cfg',
        'SpeedArbiter.tla',
      ],
      { cwd: specsDir, stdio: 'inherit' }
    );

    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (signal) {
          reject(new Error(`TLC terminated by signal ${signal}`));
        } else {
          resolve(code ?? 1);
        }
      });
    });

    if (exitCode === 0) {
      await fs.rm(metadataDir, { recursive: true, force: true });
    } else {
      console.error(`TLC run metadata retained for diagnosis: ${metadataDir}`);
    }
    process.exitCode = exitCode;
  } catch (error) {
    console.error(`TLC run metadata retained for diagnosis: ${metadataDir}`);
    throw error;
  }
}

run().catch((error) => {
  console.error(`TLC setup failed: ${error.message}`);
  process.exitCode = 1;
});
