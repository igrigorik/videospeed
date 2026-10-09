import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../../../scripts/serve.mjs';

describe('local static server', () => {
  let root;
  let server;
  let outsideFile;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
    if (outsideFile) {
      await rm(outsideFile, { force: true });
    }
    server = undefined;
    root = undefined;
    outsideFile = undefined;
  });

  it('serves files, directory listings and rejects paths outside the root', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'videospeed-serve-'));
    await writeFile(path.join(root, 'app.js'), 'export default 1;');
    await mkdir(path.join(root, 'empty-directory'));
    outsideFile = path.join(path.dirname(root), `${path.basename(root)}-secret.txt`);
    await writeFile(outsideFile, 'secret');

    server = createServer(root);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const script = await fetch(`${baseUrl}/app.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await script.text()).toBe('export default 1;');

    const listing = await fetch(`${baseUrl}/`);
    expect(listing.status).toBe(200);
    expect(await listing.text()).toContain('empty-directory/');

    const traversal = await fetch(`${baseUrl}/%2e%2e%2f${path.basename(outsideFile)}`);
    expect([403, 404]).toContain(traversal.status);
  });
});
