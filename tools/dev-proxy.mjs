/**
 * Local forward proxy for JVM build tools.
 *
 * On this machine the JVM cannot open outbound TCP connections — every connect
 * times out — while Node and curl can. Gradle, the Gradle wrapper and
 * sdkmanager are all JVM processes, so an Android build cannot fetch its own
 * dependencies. Node can, and the JVM can reach 127.0.0.1, so this bridges the
 * two: a standard HTTP proxy with CONNECT tunnelling that the build tools are
 * pointed at through the usual `http.proxyHost` system properties.
 *
 *   node tools/dev-proxy.mjs [port]
 *
 * Nothing about the app needs this; it is purely a workaround for a host that
 * firewalls the JVM. If `java -e` style network tests start passing, stop
 * using it.
 */

import http from 'node:http';
import net from 'node:net';

const port = Number(process.argv[2] ?? 8899);

const server = http.createServer((request, response) => {
  let target;
  try {
    target = new URL(request.url);
  } catch {
    response.writeHead(400).end('proxy expects an absolute URL');
    return;
  }

  const upstream = http.request(
    {
      host: target.hostname,
      port: target.port || 80,
      path: `${target.pathname}${target.search}`,
      method: request.method,
      headers: request.headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on('error', (error) => {
    console.error(`  ${target.host}: ${error.message}`);
    response.destroy();
  });
  request.pipe(upstream);
});

// HTTPS arrives as CONNECT host:port and is tunnelled byte-for-byte, so TLS is
// still end to end between the build tool and the real server.
server.on('connect', (request, clientSocket, head) => {
  const [host, rawPort] = request.url.split(':');
  const upstream = net.connect(Number(rawPort) || 443, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', (error) => {
    console.error(`  CONNECT ${request.url}: ${error.message}`);
    clientSocket.destroy();
  });
  clientSocket.on('error', () => upstream.destroy());
});

server.on('clientError', (_error, socket) => socket.destroy());

server.listen(port, '127.0.0.1', () => {
  console.log(`dev proxy on 127.0.0.1:${port}`);
});
