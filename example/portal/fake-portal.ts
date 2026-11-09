import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Route } from '@playwright/test';

export const PORTAL = 'http://portal.test';
export const DATA_DIR = fileURLToPath(new URL('../.data/', import.meta.url));
export const ADMIN_STATE = path.join(DATA_DIR, 'admin-state.json');
const DB = path.join(DATA_DIR, 'db.json');
const ADMIN_COOKIE = 'admin=ok';

type Person = { id_number: string; mobile: string; first_name: string; last_name: string; date_of_birth: string };
type User = { ref: string; company: string; user_type: string; person: Person; status: string; vettedAt?: number; username?: string };
type Member = { ref: string; member_id: string; person: Person; token: string; status: string; username?: string };
type Db = { users: Record<string, User>; members: Record<string, Member>; tokens: Record<string, string> };

const read = (): Db => {
  try {
    return JSON.parse(readFileSync(DB, 'utf8'));
  } catch {
    return { users: {}, members: {}, tokens: {} };
  }
};
const save = (db: Db) => {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DB, JSON.stringify(db, null, 2));
};

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const newPerson = (mobile?: string): Person => ({
  id_number: `A${digits(6)}(${digits(1)})`,
  mobile: mobile ?? `9${digits(7)}`,
  first_name: `AUTO ${Date.now().toString(36).toUpperCase()}`,
  last_name: 'ETOE',
  date_of_birth: '01/02/1990',
});

const html = (title: string, body: string, script = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body}<script>${script}</script></body></html>`;

const post = `const post = async (url, body) => { const r = await fetch(url, { method: 'POST', body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) { document.getElementById('error').textContent = 'Sorry! ' + j.error; throw new Error(j.error); } return j; };`;
const errorBox = '<p id="error" role="alert"></p>';
const loginForm = (button: string) =>
  `<label for="username">Username</label><input id="username"><label for="password">Password</label><input id="password" type="password"><button id="go-login">${button}</button>`;

const PAGES: Record<string, (q: URLSearchParams) => string> = {
  '/web/create': () =>
    html(
      'Create user',
      `<label for="company">Company</label><input id="company"><label for="type">User type</label><select id="type"><option>Company AP</option><option>Scheme AP</option><option>Other User</option></select><button id="go">Submit</button>${errorBox}<p id="result"></p>`,
      `${post} go.onclick = async () => { const j = await post('/api/users', { company: company.value, user_type: type.value }); result.textContent = 'Reference No.: ' + j.ref; };`,
    ),
  '/admin/login': () =>
    html('Admin login', `${loginForm('Log in')}${errorBox}`, `${post} document.getElementById('go-login').onclick = async () => { await post('/api/admin/login', { username: username.value, password: password.value }); location.href = '/admin/home'; };`),
  '/admin/home': () => html('Admin home', '<p>Logged in.</p>'),
  '/admin/vet': (q) =>
    html(
      'Document vetting',
      `<p>Case <b id="ref">${q.get('ref') ?? ''}</b>: <span id="case-status">…</span></p><button id="go">Mark all VALID</button>${errorBox}`,
      `${post} const ref = '${q.get('ref') ?? ''}'; const show = async () => { const r = await fetch('/api/users/' + ref); const j = await r.json(); document.getElementById("case-status").textContent = r.ok ? j.status : j.error; }; show(); setInterval(show, 300); go.onclick = () => post('/api/vet', { ref });`,
    ),
  '/web/activate': () =>
    html(
      'Activate your account',
      `<label for="id">ID No.</label><input id="id"><label for="mobile">Mobile</label><input id="mobile"><button id="go">Send OTP</button>${errorBox}`,
      `${post} go.onclick = async () => { const j = await post('/api/activate/verify', { id_number: id.value, mobile: mobile.value }); sessionStorage.setItem('activationToken', j.token); location.href = '/web/activate/account'; };`,
    ),
  '/web/activate/account': () =>
    html(
      'Create username and password',
      `<div id="form" hidden>${loginForm('Activate')}</div><h2 id="expired" hidden>Session expired</h2>${errorBox}<h2 id="done" hidden>Account activated</h2>`,
      `${post} const token = sessionStorage.getItem('activationToken'); if (!token) expired.hidden = false; else form.hidden = false; document.getElementById('go-login').onclick = async () => { await post('/api/activate', { token, username: username.value, password: password.value }); form.hidden = true; done.hidden = false; };`,
    ),
  '/kiosk/activate': () =>
    html(
      'Kiosk activation',
      `<div id="form" hidden><label for="id">ID No.</label><input id="id"><label for="mobile">Mobile</label><input id="mobile">${loginForm('Activate')}</div><h2 id="small" hidden>Screen too small for the kiosk</h2>${errorBox}<h2 id="done" hidden>Account activated</h2>`,
      `${post} if (innerWidth < 1920) small.hidden = false; else form.hidden = false; document.getElementById('go-login').onclick = async () => { const j = await post('/api/activate/verify', { id_number: id.value, mobile: mobile.value }); await post('/api/activate', { token: j.token, username: username.value, password: password.value }); form.hidden = true; done.hidden = false; };`,
    ),
  '/web/register': () =>
    html(
      'Register',
      `<label for="mobile">Mobile</label><input id="mobile"><button id="go">Register</button>${errorBox}<p id="result"></p><div id="activate" hidden>${loginForm('Activate now')}</div><h2 id="done" hidden>Member activated</h2>`,
      `${post} go.onclick = async () => { const j = await post('/api/members', { mobile: mobile.value }); sessionStorage.setItem('registerToken', j.token); result.textContent = 'Registration No.: ' + j.ref; activate.hidden = false; }; document.getElementById('go-login').onclick = async () => { await post('/api/members/activate', { token: sessionStorage.getItem('registerToken'), username: username.value, password: password.value }); activate.hidden = true; done.hidden = false; };`,
    ),
};

type Reply = [number, unknown];

const userStatus = (u: User) => (u.status === 'PROCESSING' && u.vettedAt && Date.now() - u.vettedAt > 1500 ? 'SUCCEED' : u.status);

const api = (db: Db, method: string, url: URL, body: Record<string, string>, cookie: string): Reply => {
  const route = `${method} ${url.pathname}`;
  if (route === 'POST /api/users') {
    if (!body.company || body.company.includes('fail')) return [400, { error: `Company "${body.company}" is not in your company list` }];
    const user: User = { ref: `DMD${digits(16)}`, company: body.company, user_type: body.user_type, person: newPerson(), status: 'SUBMITTED' };
    db.users[user.ref] = user;
    return [200, user];
  }
  if (route === 'POST /api/admin/login') return body.username === 'admin' && body.password ? [200, { ok: true }] : [401, { error: 'wrong username or password' }];
  if (method === 'GET' && url.pathname.startsWith('/api/users/')) {
    const user = db.users[url.pathname.slice('/api/users/'.length)];
    return user ? [200, { ...user, status: userStatus(user) }] : [404, { error: 'no such case' }];
  }
  if (route === 'POST /api/vet') {
    if (!cookie.includes(ADMIN_COOKIE)) return [401, { error: 'not logged in to the admin portal' }];
    const user = db.users[body.ref];
    if (!user) return [404, { error: 'no such case' }];
    Object.assign(user, { status: 'PROCESSING', vettedAt: Date.now() });
    return [200, { status: 'PROCESSING' }];
  }
  if (route === 'POST /api/activate/verify') {
    const user = Object.values(db.users).find((u) => u.person.id_number === body.id_number && u.person.mobile === body.mobile);
    if (!user) return [404, { error: 'no user with that ID and mobile' }];
    if (userStatus(user) !== 'SUCCEED') return [409, { error: `the user is ${userStatus(user)}, not vetted` }];
    const token = digits(12);
    db.tokens[token] = user.ref;
    return [200, { token }];
  }
  if (route === 'POST /api/activate') {
    const user = db.users[db.tokens[body.token] ?? ''];
    if (!user) return [401, { error: 'session expired' }];
    Object.assign(user, { status: 'ACTIVATED', username: body.username });
    return [200, { status: 'ACTIVATED' }];
  }
  if (route === 'POST /api/members') {
    const member: Member = { ref: `RGD${digits(16)}`, member_id: digits(11), person: newPerson(body.mobile || undefined), token: digits(12), status: 'REGISTERED' };
    db.members[member.ref] = member;
    return [200, member];
  }
  if (route === 'POST /api/members/activate') {
    const member = Object.values(db.members).find((m) => m.token === body.token);
    if (!member) return [401, { error: 'session expired' }];
    Object.assign(member, { status: 'ACTIVATED', username: body.username });
    return [200, { status: 'ACTIVATED' }];
  }
  return [404, { error: `no route ${route}` }];
};

const handle = async (route: Route) => {
  const request = route.request();
  const url = new URL(request.url());
  const page = PAGES[url.pathname];
  if (page) return route.fulfill({ contentType: 'text/html', body: page(url.searchParams) });
  const db = read();
  const body = request.postData() ? (JSON.parse(request.postData()!) as Record<string, string>) : {};
  const [status, reply] = api(db, request.method(), url, body, (await request.allHeaders()).cookie ?? '');
  save(db);
  const headers: Record<string, string> = request.url().endsWith('/api/admin/login') && status === 200 ? { 'set-cookie': `${ADMIN_COOKIE}; Path=/` } : {};
  return route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(reply) });
};

/**
 * Serves a tiny fake portal at {@link PORTAL} inside `context`, with its data in `example/.data/db.json`
 * so that separate runs see the same users. It has what the example functions need to show the hard
 * cases: an admin login cookie, a status that settles after a delay, a session kept in
 * `sessionStorage`, and a page that refuses a small screen.
 */
export const installPortal = (context: BrowserContext) => context.route(`${PORTAL}/**`, handle);
