// Equivalent fixtures: original task PDFs/snapshots were not attached.
// Run from repository root: node server/fixtures/planning-center/generate.mjs
import { jsPDF } from '../../../client/node_modules/jspdf/dist/jspdf.node.min.js';
import { writeFileSync } from 'node:fs';

const baseline = [
  ['5:00 Prelude & Welcome', 'Welcome and announcements.'],
  ['4:00 Opening Song: How Great Thou Art'],
  ['3:00 Prayer — Elder Naomi Brooks'],
  ['4:00 Song: Great Is Thy Faithfulness'],
  ['3:00 Scripture Reading', 'Scripture: John 3:16-18'],
  ['3:00 Prayer — Elder David Cole', 'Prayer for our community.'],
  ['5:00 Special Music', 'Choir selection.'],
  ['30:00 Sermon'],
  ['4:00 Appeal Song: I Surrender All'],
  ['3:00 Offering'],
  ['2:00 Closing Prayer'],
];
const update1 = baseline.map((row) => [...row]);
update1[0] = ['7:00 Prelude & Welcome', 'Welcome, announcements and guest introduction.'];
update1[5][1] = 'Prayer for our community and ministry partners.';
update1[7][0] = '35:00 Sermon';
update1.splice(10, 0, ['4:00 Ministry Spotlight — NEW']);
const update2 = update1.map((row) => [...row]);
update2.splice(6, 1); // Special Music disappears; a new Prayer must never claim it.
update2.splice(4, 0, update2.splice(7, 1)[0]); // actual song reorder
update2[0][0] = '6:00 Prelude & Welcome';
update2.splice(7, 0, ['3:00 Prayer'], ['3:00 Prayer']);
update2.splice(10, 0, ['3:00 Prayer — Elder David Cole', 'Additional dedication prayer.']);
for (const [name, rows] of [
  ['01_Planning_Center_Baseline', baseline],
  ['02_Planning_Center_Update_1', update1],
  ['03_Planning_Center_Update_2', update2],
]) {
  const lines = ['Sunday Worship', 'October 25, 2026', 'Length', 'in mins', 'Worship', ...rows.flat()];
  const pdf = new jsPDF();
  pdf.setCreationDate(new Date('2026-10-25T10:00:00Z'));
  pdf.setFileId('0123456789ABCDEF0123456789ABCDEF');
  pdf.setFontSize(11);
  lines.forEach((line, index) => pdf.text(line, 15, 15 + index * 7));
  writeFileSync(new URL(`${name}.pdf`, import.meta.url), Buffer.from(pdf.output('arraybuffer')));
}
