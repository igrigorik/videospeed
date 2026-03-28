import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const pkg = require(path.join(rootDir, 'package.json'));

const version = pkg.version;
const tag = `v${version}`;
const releaseDir = path.join(rootDir, 'release');
const zipName = `videospeed-${version}.zip`;
const zipPath = path.join(releaseDir, zipName);

function run(cmd) {
  return execSync(cmd, { encoding: 'utf-8', cwd: rootDir }).trim();
}

function check(label, condition, message) {
  if (!condition) {
    console.error(`❌ ${label}: ${message}`);
    process.exit(1);
  }
}

async function createRelease() {
  // Verify gh CLI is available
  try {
    run('gh --version');
  } catch {
    check('GitHub CLI', false, 'gh is not installed. Install from https://cli.github.com');
  }

  // Verify gh is authenticated
  try {
    run('gh auth status');
  } catch {
    check('GitHub auth', false, 'gh is not authenticated. Run "gh auth login".');
  }

  // Verify release zip exists
  check(
    'Release zip',
    await fs.pathExists(zipPath),
    `${zipName} not found. Run "npm run release" first.`
  );

  // Verify git tag exists
  try {
    run(`git rev-parse ${tag}`);
  } catch {
    check(
      'Git tag',
      false,
      `Tag ${tag} not found. Create it with: git tag ${tag} && git push origin ${tag}`
    );
  }

  // Find previous tag for release notes
  let prevTag;
  try {
    prevTag = run(`git describe --tags --abbrev=0 ${tag}^`);
  } catch {
    prevTag = null;
  }

  // Generate release notes from commits
  const range = prevTag ? `${prevTag}..${tag}` : tag;
  let notes;
  try {
    const log = run(`git log ${range} --pretty=format:"- %s (%h)"`);
    notes = `## What's Changed\n\n${log}\n`;
  } catch {
    notes = `Release ${tag}`;
  }

  // Write notes to temp file to avoid shell escaping issues
  const notesFile = path.join(releaseDir, '.release-notes.md');
  await fs.writeFile(notesFile, notes);

  try {
    const result = run(
      `gh release create ${tag} ${zipPath} --title "Video Speed Controller ${tag}" --notes-file ${notesFile} --draft`
    );
    console.log(`✅ Draft release created: ${result}`);
    console.log('   Review and publish at the URL above.');
  } finally {
    await fs.remove(notesFile);
  }
}

createRelease().catch((err) => {
  console.error('❌ Release creation failed:', err);
  process.exit(1);
});
