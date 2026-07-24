// One-off local script to generate a new Spotify refresh token.
// Run with: node scripts/get-refresh-token.js
// Prompts for Client ID/Secret (kept out of shell history/chat logs),
// opens the Spotify authorize page, catches the redirect on
// http://localhost:3000/callback, and prints the new refresh token.

const http = require('http');
const https = require('https');
const { URL, URLSearchParams } = require('url');
const readline = require('readline');
const { exec } = require('child_process');

const REDIRECT_URI = 'http://127.0.0.1:3000/callback';
const PORT = 3000;
const SCOPES = [
  'playlist-modify-public',
  'playlist-modify-private',
  'playlist-read-private'
].join(' ');

const ENTER_CODES = [10, 13]; // \n, \r
const CTRL_C_CODE = 3;
const BACKSPACE_CODES = [8, 127]; // backspace, DEL

function prompt(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!hidden) {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }
    // Hide input for the client secret
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (char) => {
      char = char.toString();
      const code = char.charCodeAt(0);
      if (ENTER_CODES.includes(code)) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(value.trim());
      } else if (code === CTRL_C_CODE) {
        process.exit(1);
      } else if (BACKSPACE_CODES.includes(code)) {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? `open "${url}"`
    : platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function exchangeCodeForTokens(code, clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI
    }).toString();

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const req = https.request(
      {
        hostname: 'accounts.spotify.com',
        path: '/api/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Basic ${auth}`
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(`Token exchange failed: ${data}`));
            } else {
              resolve(json);
            }
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const clientId = await prompt('Spotify Client ID: ');
  const clientSecret = await prompt('Spotify Client Secret: ', true);

  const authorizeUrl = new URL('https://accounts.spotify.com/authorize');
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI
  }).toString();

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, REDIRECT_URI);
    if (reqUrl.pathname !== '/callback') {
      res.writeHead(404);
      res.end();
      return;
    }

    const code = reqUrl.searchParams.get('code');
    const error = reqUrl.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(`Authorization failed: ${error}`);
      console.error(`\nAuthorization failed: ${error}`);
      server.close();
      process.exit(1);
      return;
    }

    try {
      const tokens = await exchangeCodeForTokens(code, clientId, clientSecret);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Success! You can close this tab and return to the terminal.');

      console.log('\nNew tokens received:');
      console.log(`  Access token:  ${tokens.access_token}`);
      console.log(`  Refresh token: ${tokens.refresh_token}`);
      console.log('\nUpdate the SPOTIFY_REFRESH_TOKEN secret in GitHub with the refresh token above.');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Token exchange failed, check the terminal.');
      console.error('\nToken exchange failed:', err.message);
    } finally {
      server.close();
      process.exit(0);
    }
  });

  server.listen(PORT, () => {
    console.log(`\nOpening browser for Spotify authorization...`);
    console.log(`If it doesn't open automatically, visit:\n${authorizeUrl.toString()}\n`);
    openBrowser(authorizeUrl.toString());
  });
}

main();
