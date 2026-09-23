// Records one explainer video against a running local stack. See README.md.
//
//   node scripts/explainer-video/record.js <video>      # e.g. sales-entry
//   VIDEO_LANG=bn node scripts/explainer-video/record.js sales-entry
const fs = require('fs');
const path = require('path');
const { record } = require('./lib/recorder');

const name = process.argv[2];
const videos = fs.readdirSync(path.join(__dirname, 'videos')).map((f) => f.replace(/\.js$/, ''));
if (!videos.includes(name)) {
  console.error(`usage: node record.js <video>   (one of: ${videos.join(', ')})`);
  process.exit(1);
}
record(name, process.env.VIDEO_LANG || 'en').catch((e) => { console.error(e); process.exit(1); });
