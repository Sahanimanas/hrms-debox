// Integration checks for the shared platform pieces (module loader, scheduler, file storage)
import { createRequire } from 'node:module';
import { run, section, check, get, post, bootstrap, createUser, BASE } from '../lib/harness.mjs';

const require = createRequire(import.meta.url);
const ORIGIN = BASE.replace(/\/api$/, '');

await run(async () => {
  const admin = await bootstrap();
  const emp = await createUser(admin, { role: 'employee' });

  section('Core module loader');
  const modules = ['payroll', 'lifecycle', 'leave', 'engagement', 'performance', 'recruitment', 'assets', 'analytics', 'platform'];
  for (const m of modules) {
    const r = await get(`/v2/${m}/health`, admin);
    check(`module ${m} is mounted`, r.s === 200, r);
  }

  section('Core scheduler');
  let r = await get('/v2/jobs', emp.token);
  check('employees cannot list scheduled jobs', r.s === 403, r);
  r = await get('/v2/jobs', admin);
  const names = (r.d || []).map(j => j.name);
  check('scheduled jobs registered from every module', r.s === 200 && names.length >= 15, names);
  const legacy = r.d?.find(j => j.name === 'monthly-leave-credit');
  check('legacy monthly leave credit stays off unless enabled', legacy && legacy.enabled === false, legacy);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  check('job names are unique', dupes.length === 0, dupes);
  r = await post('/v2/jobs/no-such-job/run', admin, {});
  check('unknown job returns 404', r.s === 404, r);

  section('Core file storage');
  process.env.S3_ENDPOINT_URL = '';
  const { storeFile, readStoredFile } = require('../../services/fileStorage');
  const pub = await storeFile(Buffer.from('public-file'), 'note.txt', 'text/plain', 'core-test', 'x');
  const priv = await storeFile(Buffer.from('secret-file'), 'cv.pdf', 'application/pdf', 'core-test', 'x', { visibility: 'private' });
  check('private files have no public URL', priv.url === null && priv.key.startsWith('local/private/'), priv);
  let res = await fetch(`${ORIGIN}/uploads/${pub.key.slice('local/'.length)}`);
  check('public uploads are served', res.status === 200 && (await res.text()) === 'public-file');
  res = await fetch(`${ORIGIN}/uploads/${priv.key.slice('local/'.length)}`);
  check('private uploads are never served statically', res.status === 404);
  res = await fetch(`${ORIGIN}/uploads/PRIVATE/${priv.key.split('/').slice(2).join('/')}`);
  check('case variations of the private path are not served either', res.status === 404);
  res = await fetch(`${ORIGIN}/uploads/core-test/../private/core-test/x/${priv.key.split('/').pop()}`);
  check('path traversal into private files is not served', res.status === 404 || res.status === 400);
  const back = await readStoredFile(priv.key);
  check('private files can be read back server-side', back?.toString() === 'secret-file');
});
