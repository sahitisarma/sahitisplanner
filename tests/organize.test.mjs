import { organize } from '../js/organize.js';
import { monthGrid, startOfWeek, weekDays, parseKey } from '../js/dates.js';
import assert from 'node:assert';
const today = '2026-11-23'; // a Monday
const r = organize('Buy milk at Target, call the dentist tomorrow, and dinner Friday at seven', { today, stores: ['Target'] });
console.log(r);
assert.equal(r[0].type, 'tobuy'); assert.equal(r[0].store, 'Target'); assert.equal(r[0].title, 'Milk');
assert.equal(r[1].type, 'errand'); assert.equal(r[1].date, '2026-11-24');
assert.equal(r[2].type, 'event'); assert.equal(r[2].date, '2026-11-27'); assert.equal(r[2].time, '19:00');
const r2 = organize('get eggs and bread from Trader Joe’s; finish slides by 12/1, lunch with Ivy next tuesday at 12:30pm', { today, stores: ['Target', 'Trader Joe’s'] });
console.log(r2);
// Sunday start everywhere
for (const k of ['2026-11-01','2026-11-23','2026-02-14','2027-01-01']) {
  assert.equal(parseKey(monthGrid(k)[0]).getDay(), 0);
  assert.equal(parseKey(startOfWeek(k)).getDay(), 0);
  assert.equal(parseKey(weekDays(k)[0]).getDay(), 0);
}
console.log('ok');
