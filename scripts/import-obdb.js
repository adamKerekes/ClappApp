#!/usr/bin/env node
/**
 * Az OBDb Peugeot-508 jelkészletéből (https://github.com/OBDb/Peugeot-508, CC BY-SA 4.0)
 * tömör listát készít az apphoz: src/lib/obd/data/obdb-peugeot-508.json
 *
 * Használat: node scripts/import-obdb.js <útvonal a signalsets/v3/default.json fájlhoz>
 */
const fs = require('fs');
const path = require('path');

const source = process.argv[2];
if (!source) {
  console.error('Add meg a default.json útvonalát.');
  process.exit(1);
}
const { commands } = JSON.parse(fs.readFileSync(source, 'utf8'));

const round = (n) => (typeof n === 'number' ? Number(n.toPrecision(8)) : undefined);

const out = commands.map((c) => {
  const [service, id] = Object.entries(c.cmd)[0];
  return {
    tx: c.hdr,
    rx: c.rax,
    service,
    id,
    ...(c.din ? { session: c.din } : {}),
    signals: c.signals.map((s) => {
      const f = s.fmt;
      const sig = { id: s.id, name: s.name, group: s.path, unit: f.unit, len: f.len };
      if (f.bix) sig.bix = f.bix;
      if (f.sign) sig.sign = true;
      if (f.blsb) sig.blsb = true;
      if (f.mul !== undefined) sig.mul = round(f.mul);
      if (f.div !== undefined) sig.div = round(f.div);
      if (f.add !== undefined) sig.add = round(f.add);
      return sig;
    }),
  };
});

const target = path.join(__dirname, '..', 'src', 'lib', 'obd', 'data', 'obdb-peugeot-508.json');
fs.writeFileSync(target, JSON.stringify(out) + '\n');
console.log(`${out.length} kérés, ${out.reduce((n, c) => n + c.signals.length, 0)} jel -> ${target}`);
