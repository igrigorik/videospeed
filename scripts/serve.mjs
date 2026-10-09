import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]
  );
}

function directoryListing(pathname, entries) {
  const safePathname = pathname.split('/').map(encodeURIComponent).join('/');
  const rows = entries
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const name = `${entry.name}${entry.isDirectory() ? '/' : ''}`;
      const href = `${safePathname}${encodeURIComponent(entry.name)}${entry.isDirectory() ? '/' : ''}`;
      return `<li><a href="${href}">${escapeHtml(name)}</a></li>`;
    })
    .join('\n');
  const title = `Index of ${escapeHtml(pathname)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><ul>${rows}</ul></body></html>`;
}

export function createServer(root = process.cwd()) {
  const resolvedRoot = path.resolve(root);

  return createHttpServer(async (request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }

    const filePath = path.resolve(resolvedRoot, `.${pathname}`);
    const relativePath = path.relative(resolvedRoot, filePath);
    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    try {
      const fileStat = await stat(filePath);
      if (fileStat.isDirectory()) {
        if (!pathname.endsWith('/')) {
          response
            .writeHead(301, {
              Location: `${pathname}/${new URL(request.url, 'http://localhost').search}`,
            })
            .end();
          return;
        }

        const indexPath = path.join(filePath, 'index.html');
        try {
          if ((await stat(indexPath)).isFile()) {
            response.writeHead(200, { 'Content-Type': mimeTypes['.html'] });
            createReadStream(indexPath).pipe(response);
            return;
          }
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }

        const listing = directoryListing(
          pathname,
          await readdir(filePath, { withFileTypes: true })
        );
        response.writeHead(200, { 'Content-Type': mimeTypes['.html'] });
        response.end(listing);
        return;
      }

      if (!fileStat.isFile()) {
        response.writeHead(404).end('Not found');
        return;
      }

      response.writeHead(200, {
        'Content-Type':
          mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': fileStat.size,
      });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500);
      response.end(
        error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 'Not found' : 'Server error'
      );
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 8000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('PORT must be an integer between 0 and 65535.');
    process.exitCode = 1;
  } else {
    const server = createServer();
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      console.log(`Serving ${process.cwd()} at http://127.0.0.1:${address.port}/`);
    });
  }
}
