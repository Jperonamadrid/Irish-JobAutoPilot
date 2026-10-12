const test = require('node:test');
const assert = require('node:assert');
const { locate } = require('../core/geo');

const at = (job) => locate({ title: 'Admin', description: '', ...job });

test('named Dublin areas and postal districts', () => {
  assert.strictEqual(at({ location: 'Sandyford, Dublin 18' }).label, 'Sandyford');
  assert.strictEqual(at({ location: "St James's Hospital, Dublin 8" }).label, 'Heuston / Kilmainham');
  assert.strictEqual(at({ location: 'Dublin 6W' }).label, 'Dublin 6W');
  assert.strictEqual(at({ location: 'Dublin 2, Ireland' }).label, 'Dublin 2');
  assert.strictEqual(at({ location: 'Grand Canal Dock, Dublin' }).precision, 'area');
});

test('city-only location is refined from the description, or marked as area not stated', () => {
  const j = at({ location: 'Dublin, County Dublin, Ireland', description: 'You will be based in our new office in Cherrywood, Dublin 18.' });
  assert.match(j.label, /Cherrywood/);
  assert.strictEqual(at({ location: 'Dublin, Ireland' }).label, 'Dublin (area not stated)');
  assert.strictEqual(at({ location: 'Dublin', description: 'Offices in Cork, Galway and London.' }).label, 'Dublin (area not stated)', 'other cities in the text do not move a Dublin job');
});

test('Eircodes, other cities, remote, unknown', () => {
  assert.strictEqual(at({ location: 'Main St, Swords, Co. Dublin, K67 X2Y3' }).label, 'Swords');
  assert.strictEqual(at({ location: 'Unit 4, A94 F2C3' }).label, 'Blackrock');
  assert.strictEqual(at({ location: 'Cork, Ireland' }).label, 'Cork');
  assert.strictEqual(at({ location: 'Kerry County Council' }).label, 'Tralee');
  assert.strictEqual(at({ location: 'Remote (EMEA)' }).precision, 'remote');
  assert.strictEqual(at({ location: 'Hybrid remote, Dublin' }).precision, 'city');
  assert.strictEqual(at({ location: 'Somewhere' }), null);
});

test('an office area stated in the posting wins over a city-only location', () => {
  const j = locate({ location: 'Dublin, Ireland', area: 'Barrow Street, Dublin 4', description: '' });
  assert.strictEqual(j.precision, 'area');
  assert.match(j.label, /Grand Canal Dock/);
  assert.strictEqual(locate({ location: 'Dublin', area: '', description: '' }).label, 'Dublin (area not stated)');
});
