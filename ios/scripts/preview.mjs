// Web preview on the server: serves the Metro web dev server and Hearth's API from one origin, so the web build can
// call /api without CORS, and adds the credentials the phone would send. Needs the token in the environment:
//   HEARTH_TOKEN=$(sudo cat /etc/hearth/token) HEARTH_LOGIN=you@github node scripts/preview.mjs
// → http://127.0.0.1:8091 (Metro on :8083, Hearth on :8010; API_PORT to point elsewhere).
import http from 'node:http'

const API = Number(process.env.API_PORT || 8010)
const TOKEN = process.env.HEARTH_TOKEN || ''
const LOGIN = process.env.HEARTH_LOGIN || ''
http.createServer((req, res) => {
  const api = req.url.startsWith('/api/')
  const headers = { ...req.headers }
  if (api) {
    if (TOKEN) headers.authorization = `Bearer ${TOKEN}`
    if (LOGIN) headers['tailscale-user-login'] = LOGIN
  }
  const up = http.request({ host: '127.0.0.1', port: api ? API : 8083, path: req.url, method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers)
    r.pipe(res)
  })
  up.on('error', () => { res.writeHead(502); res.end() })
  req.pipe(up)
}).listen(8091, '127.0.0.1', () => console.log('preview on http://127.0.0.1:8091'))
