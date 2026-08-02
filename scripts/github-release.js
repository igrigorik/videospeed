import crypto from 'crypto';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const pkg = require(path.join(rootDir, 'package.json'));

const version = pkg.version;
const tag = `v${version}`;
const releaseDir = path.join(rootDir, 'release');
const zipName = `videospeed-${version}.zip`;
const zipPath = path.join(releaseDir, zipName);
const curatedNotesPath = path.join(rootDir, 'docs', `release-${version}.md`);
const artifactName = 'videospeed-release-node-22.x';
const dryRun = process.argv.includes('--dry-run');

function runFile(command, args) {
  return execFileSync(command, args, { encoding: 'utf-8', cwd: rootDir }).trim();
}

function check(label, condition, message) {
  if (!condition) {
    throw new Error(`${label}: ${message}`);
  }
}

export function prepareReleaseNotes(source) {
  const lines = source.replaceAll('\r\n', '\n').split('\n');

  if (/^#\s+Release\b/.test(lines[0] || '')) {
    lines.shift();
  }
  while (lines[0]?.trim() === '') {
    lines.shift();
  }
  if (/^Status:/i.test(lines[0] || '')) {
    lines.shift();
  }
  while (lines[0]?.trim() === '') {
    lines.shift();
  }

  return `${lines.join('\n').trim()}\n`;
}

export function parseGitHubRepo(remoteUrl) {
  const normalized = remoteUrl.trim().replace(/\.git$/, '');
  const scpMatch = normalized.match(/^git@github\.com:([^/:\s]+\/[^/\s]+)$/);
  if (scpMatch) {
    return scpMatch[1];
  }

  try {
    const url = new URL(normalized);
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (url.hostname !== 'github.com' || pathParts.length !== 2) {
      return null;
    }
    return pathParts.join('/');
  } catch {
    return null;
  }
}

export function parseRemoteTagRefs(output, tagName) {
  const refs = { direct: null, peeled: null };

  for (const line of output.split('\n').filter(Boolean)) {
    const [commit, ref] = line.split(/\s+/);
    if (ref === `refs/tags/${tagName}^{}`) {
      refs.peeled = commit;
    } else if (ref === `refs/tags/${tagName}`) {
      refs.direct = commit;
    }
  }

  return refs;
}

export function findSuccessfulCiRun(runs, commit) {
  return runs.find(
    (run) =>
      run.headSha === commit &&
      run.event === 'push' &&
      run.status === 'completed' &&
      run.conclusion === 'success'
  );
}

export function inspectReleaseZip(archivePath, expectedVersion) {
  runFile('unzip', ['-tqq', archivePath]);
  const entries = runFile('unzip', ['-Z1', archivePath]).split('\n').filter(Boolean);
  const unsafeEntry = entries.find(
    (entry) => entry.startsWith('/') || entry.split('/').includes('..')
  );
  check('Release zip', !unsafeEntry, `archive contains unsafe path ${unsafeEntry}`);
  check('Release zip', entries.includes('manifest.json'), 'manifest.json is missing');
  check(
    'Release zip',
    !entries.some((entry) => entry.endsWith('.map')),
    'source maps must not be published'
  );

  const manifest = JSON.parse(runFile('unzip', ['-p', archivePath, 'manifest.json']));
  check(
    'Release zip',
    manifest.version === expectedVersion,
    `manifest version is ${manifest.version}, expected ${expectedVersion}`
  );

  return {
    entries,
    manifest,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex'),
  };
}

function getReleaseContext() {
  runFile('gh', ['--version']);
  runFile('gh', ['auth', 'status', '--hostname', 'github.com']);

  check(
    'Git worktree',
    runFile('git', ['status', '--porcelain', '--untracked-files=all']) === '',
    'tracked or untracked changes remain; commit or remove them before creating a release'
  );

  const notesRelativePath = path.relative(rootDir, curatedNotesPath).split(path.sep).join('/');
  check('Curated notes', fs.existsSync(curatedNotesPath), `${notesRelativePath} not found`);
  try {
    runFile('git', ['ls-files', '--error-unmatch', notesRelativePath]);
  } catch {
    check('Curated notes', false, `${notesRelativePath} is not tracked by Git`);
  }

  const curatedNotes = fs.readFileSync(curatedNotesPath, 'utf8');
  check(
    'Curated notes',
    !/^Status:\s*DRAFT\b/im.test(curatedNotes),
    'remove the Status: DRAFT marker before creating the release'
  );
  const notes = prepareReleaseNotes(curatedNotes);
  check('Curated notes', notes.trim().length > 0, 'release notes are empty');

  const originUrl = runFile('git', ['remote', 'get-url', 'origin']);
  const repoPath = parseGitHubRepo(originUrl);
  check('Git remote', Boolean(repoPath), `origin is not a supported GitHub URL: ${originUrl}`);
  const repo = `github.com/${repoPath}`;

  const headCommit = runFile('git', ['rev-parse', 'HEAD']);
  const remoteMasterOutput = runFile('git', ['ls-remote', 'origin', 'refs/heads/master']);
  const remoteMasterCommit = remoteMasterOutput.split(/\s+/)[0] || null;
  check('Remote master', Boolean(remoteMasterCommit), 'origin/master not found');
  check(
    'Remote master',
    remoteMasterCommit === headCommit,
    `origin/master is ${remoteMasterCommit}, not HEAD ${headCommit}`
  );

  const tagType = runFile('git', ['cat-file', '-t', tag]);
  check('Git tag', tagType === 'tag', `${tag} must be an annotated tag`);
  const tagCommit = runFile('git', ['rev-parse', `${tag}^{commit}`]);
  const tagObject = runFile('git', ['rev-parse', tag]);
  check('Git tag', tagCommit === headCommit, `${tag} does not point at HEAD ${headCommit}`);

  const remoteTagOutput = runFile('git', [
    'ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`
  ]);
  const remoteTagRefs = parseRemoteTagRefs(remoteTagOutput, tag);
  check('Remote tag', Boolean(remoteTagRefs.direct), `${tag} has not been pushed to origin`);
  check('Remote tag', Boolean(remoteTagRefs.peeled), `origin/${tag} is not annotated`);
  check(
    'Remote tag',
    remoteTagRefs.direct === tagObject,
    `origin/${tag} is not the local annotated tag object`
  );
  check(
    'Remote tag',
    remoteTagRefs.peeled === headCommit,
    `origin/${tag} resolves to ${remoteTagRefs.peeled}, not HEAD ${headCommit}`
  );

  const runs = JSON.parse(
    runFile('gh', [
      'run',
      'list',
      '--repo',
      repo,
      '--workflow',
      'CI',
      '--commit',
      headCommit,
      '--limit',
      '10',
      '--json',
      'databaseId,headSha,event,status,conclusion,url',
    ])
  );
  const ciRun = findSuccessfulCiRun(runs, headCommit);
  check('Exact-commit CI', Boolean(ciRun), `no successful CI push run found for ${headCommit}`);

  return { repo, headCommit, notes, ciRun };
}

async function createRelease() {
  const { repo, notes, ciRun } = getReleaseContext();
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), `vsc-release-${ciRun.databaseId}-`));
  const artifactZip = path.join(artifactDir, zipName);
  const notesFile = path.join(artifactDir, 'release-notes.md');

  try {
    runFile('gh', [
      'run',
      'download',
      String(ciRun.databaseId),
      '--repo',
      repo,
      '--name',
      artifactName,
      '--dir',
      artifactDir,
    ]);
    check(
      'CI artifact',
      await fs.pathExists(artifactZip),
      `${zipName} was not present in ${artifactName}`
    );

    const archive = inspectReleaseZip(artifactZip, version);
    console.log(`✅ Exact-commit CI: ${ciRun.url}`);
    console.log(`✅ CI artifact SHA-256: ${archive.sha256}`);

    const args = [
      'release',
      'create',
      tag,
      zipPath,
      '--repo',
      repo,
      '--title',
      tag,
      '--notes-file',
      notesFile,
      '--draft',
      '--verify-tag',
    ];

    if (dryRun) {
      console.log(`✅ Release inputs verified for ${tag}`);
      console.log(`   Would create a draft in ${repo} with the verified CI artifact.`);
      return;
    }

    await fs.ensureDir(releaseDir);
    await fs.copy(artifactZip, zipPath, { overwrite: true });
    await fs.writeFile(notesFile, notes);
    const result = runFile('gh', args);
    console.log(`✅ Draft release created: ${result}`);
    console.log(
      '   Review the tag, notes, archive, manifest version, and checksum before publishing.'
    );
  } finally {
    await fs.remove(artifactDir);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createRelease().catch((error) => {
    console.error(`❌ Release creation failed: ${error.message}`);
    process.exit(1);
  });
}
