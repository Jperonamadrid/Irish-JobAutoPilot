// Rough job locations for the map, from a built-in list of Irish places (no online lookups, so it
// is free, fast and never rate-limited). Coordinates are area centres, not exact offices.
//   precision: 'area'   a named district, business park, postal district or Eircode area
//              'city'   only the city/town is known (e.g. just "Dublin")
//              'remote' remote job (not placed on the map)
const { norm } = require('./util');

// [name or aliases, lat, lng, label]. More specific places first.
const AREAS = [
  // Dublin business areas
  ['grand canal dock|grand canal square|silicon docks|barrow street|hanover quay|grand canal quay', 53.3395, -6.2380, 'Grand Canal Dock'],
  ['sir john rogersons quay|city quay|georges quay|tara street', 53.3460, -6.2470, 'City Quay'],
  ['ifsc|financial services centre|north wall quay|spencer dock|north dock|mayor street|custom house', 53.3490, -6.2420, 'IFSC / North Docks'],
  ['ballsbridge|pembroke road|merrion road|shelbourne road|lansdowne', 53.3290, -6.2310, 'Ballsbridge'],
  ['sandyford|central park|beacon south quarter', 53.2770, -6.2160, 'Sandyford'],
  ['leopardstown|south county business park', 53.2680, -6.2010, 'Leopardstown'],
  ['cherrywood', 53.2440, -6.1450, 'Cherrywood'],
  ['carrickmines', 53.2560, -6.1730, 'Carrickmines'],
  ['citywest|city west|saggart', 53.2840, -6.4210, 'Citywest'],
  ['parkwest|park west|nangor road', 53.3330, -6.3820, 'Parkwest'],
  ['grange castle|grangecastle', 53.3170, -6.4410, 'Grange Castle'],
  ['blanchardstown|damastown|corduff|mulhuddart', 53.3880, -6.3770, 'Blanchardstown'],
  ['liffey valley', 53.3540, -6.3920, 'Liffey Valley'],
  ['dublin airport|airside|collinstown', 53.4264, -6.2499, 'Dublin Airport'],
  ['swords', 53.4597, -6.2181, 'Swords'],
  ['santry|northwood|ballymun', 53.3970, -6.2490, 'Santry'],
  ['east point|eastpoint business park|east wall', 53.3560, -6.2240, 'East Point'],
  ['clonskeagh|beech hill|roebuck', 53.3110, -6.2330, 'Clonskeagh'],
  ['belfield|ucd|university college dublin', 53.3070, -6.2230, 'UCD Belfield'],
  ['dundrum', 53.2920, -6.2450, 'Dundrum'],
  ['stillorgan|mount merrion', 53.2890, -6.1990, 'Stillorgan'],
  ['blackrock', 53.3015, -6.1778, 'Blackrock'],
  ['dun laoghaire|dún laoghaire|glenageary|dalkey', 53.2940, -6.1340, 'Dún Laoghaire'],
  ['tallaght', 53.2880, -6.3730, 'Tallaght'],
  ['clondalkin|ballymount|red cow', 53.3200, -6.3950, 'Clondalkin'],
  ['lucan|adamstown', 53.3570, -6.4480, 'Lucan'],
  ['malahide', 53.4500, -6.1540, 'Malahide'],
  ['howth|sutton', 53.3870, -6.0650, 'Howth'],
  ['smithfield|stoneybatter', 53.3480, -6.2780, 'Smithfield'],
  ['heuston|st jamess|kilmainham', 53.3430, -6.3000, 'Heuston / Kilmainham'],
  ['inchicore', 53.3390, -6.3220, 'Inchicore'],
  ['temple bar|dame street|college green|trinity college', 53.3445, -6.2620, 'Temple Bar'],
  ['st stephens green|stephens green|harcourt street|harcourt|leeson street|earlsfort terrace', 53.3360, -6.2600, "St Stephen's Green"],
  ['baggot street|fitzwilliam|merrion square|mount street', 53.3370, -6.2470, 'Merrion Square'],
  ['ranelagh', 53.3260, -6.2560, 'Ranelagh'],
  ['rathmines', 53.3220, -6.2650, 'Rathmines'],
  ['drumcondra|dcu|dublin city university|glasnevin', 53.3700, -6.2600, 'Drumcondra'],
  ['phibsborough|mater', 53.3600, -6.2730, 'Phibsborough'],
  ['naas road|bluebell', 53.3260, -6.3390, 'Naas Road'],
  ['baldonnel|casement', 53.3020, -6.4510, 'Baldonnel'],
  ['st vincents university hospital|st vincents hospital|elm park', 53.3170, -6.2120, "St Vincent's Hospital"],
  ['beaumont hospital|beaumont', 53.3900, -6.2230, 'Beaumont'],
  ['mater hospital|mater misericordiae', 53.3600, -6.2670, 'Mater Hospital'],
  ['tallaght university hospital|tallaght hospital', 53.2910, -6.3790, 'Tallaght Hospital'],
  ['connolly hospital', 53.3880, -6.3640, 'Connolly Hospital'],
  ['north dublin|dublin north|fingal', 53.4000, -6.2400, 'North Dublin'],
  ['south dublin|dublin south', 53.2900, -6.2600, 'South Dublin'],
  ['west dublin|dublin west', 53.3400, -6.4000, 'West Dublin'],
  ['leixlip', 53.3650, -6.4950, 'Leixlip'],
  ['maynooth', 53.3810, -6.5910, 'Maynooth'],
  ['celbridge', 53.3400, -6.5390, 'Celbridge'],
  ['bray', 53.2030, -6.0980, 'Bray'],
  ['greystones', 53.1440, -6.0630, 'Greystones'],
  ['balbriggan', 53.6120, -6.1820, 'Balbriggan'],
  ['naas', 53.2159, -6.6669, 'Naas'],
  ['newbridge', 53.1810, -6.7970, 'Newbridge']
];

// Dublin postal districts (approximate centres).
const DISTRICTS = { 1: [53.3520, -6.2600], 2: [53.3400, -6.2570], 3: [53.3640, -6.2220], 4: [53.3290, -6.2280], 5: [53.3830, -6.2000],
  6: [53.3200, -6.2650], '6w': [53.3110, -6.2950], 7: [53.3560, -6.2850], 8: [53.3380, -6.2900], 9: [53.3800, -6.2400], 10: [53.3400, -6.3500],
  11: [53.3900, -6.2900], 12: [53.3200, -6.3200], 13: [53.3950, -6.1600], 14: [53.3000, -6.2500], 15: [53.3870, -6.3770],
  16: [53.2850, -6.2650], 17: [53.3950, -6.2000], 18: [53.2650, -6.1900], 20: [53.3500, -6.3800], 22: [53.3250, -6.3950], 24: [53.2880, -6.3730] };

// Eircode routing keys outside the D-districts.
const EIRCODES = { A94: [53.3015, -6.1778, 'Blackrock'], A96: [53.2850, -6.1350, 'Dún Laoghaire'], K67: [53.4597, -6.2181, 'Swords'],
  K78: [53.3570, -6.4480, 'Lucan'], K32: [53.6120, -6.1820, 'Balbriggan'], K36: [53.4500, -6.1540, 'Malahide'], A98: [53.2030, -6.0980, 'Bray'],
  W23: [53.3810, -6.5910, 'Maynooth'], W91: [53.2159, -6.6669, 'Naas'], T12: [51.8985, -8.4756, 'Cork'], T23: [51.9000, -8.5000, 'Cork'],
  H91: [53.2707, -9.0568, 'Galway'], V94: [52.6638, -8.6267, 'Limerick'], X91: [52.2593, -7.1101, 'Waterford'], R95: [52.6541, -7.2448, 'Kilkenny'] };

// Cities, towns and counties (centre of the main town).
const PLACES = [
  ['cork', 51.8985, -8.4756], ['galway', 53.2707, -9.0568], ['limerick', 52.6638, -8.6267], ['waterford', 52.2593, -7.1101],
  ['kilkenny', 52.6541, -7.2448], ['athlone', 53.4239, -7.9407], ['drogheda', 53.7179, -6.3561], ['dundalk|louth', 54.0090, -6.4049],
  ['sligo', 54.2766, -8.4761], ['letterkenny|donegal', 54.9558, -7.7342], ['tralee|kerry', 52.2713, -9.6999], ['killarney', 52.0599, -9.5044],
  ['wexford', 52.3369, -6.4633], ['carlow', 52.8365, -6.9341], ['shannon', 52.7037, -8.8642], ['ennis|clare', 52.8436, -8.9864],
  ['mullingar|westmeath', 53.5254, -7.3381], ['navan|meath', 53.6528, -6.6814], ['wicklow', 52.9808, -6.0446], ['kildare', 53.1589, -6.9096],
  ['clonmel|tipperary', 52.3550, -7.7039], ['castlebar|mayo', 53.8550, -9.2988], ['roscommon', 53.6333, -8.1833], ['longford', 53.7276, -7.7983],
  ['cavan', 53.9908, -7.3606], ['monaghan', 54.2492, -6.9683], ['portlaoise|laois', 53.0344, -7.2998], ['tullamore|offaly', 53.2739, -7.4889],
  ['carrick on shannon|leitrim', 53.9469, -8.0900], ['belfast', 54.5973, -5.9301], ['derry|londonderry', 54.9966, -7.3086]
].map(([n, lat, lng]) => [n, lat, lng, n.split('|')[0].replace(/\b\w/g, c => c.toUpperCase())]);

const DUBLIN = [53.3498, -6.2603];
// Apostrophes are dropped (not split) so "St James's" matches "st jamess".
const gnorm = s => norm(String(s ?? '').replace(/['’]/g, ''));
const wordRe = names => new RegExp(`(^| )(${names.split('|').map(gnorm).join('|')})( |$)`);
const AREA_RE = AREAS.map(([n, lat, lng, label]) => [wordRe(n), lat, lng, label]);
const PLACE_RE = PLACES.map(([n, lat, lng, label]) => [wordRe(n), lat, lng, label]);

function findArea(text) {
  const t = gnorm(text);
  if (!t) return null;
  for (const [re, lat, lng, label] of AREA_RE) if (re.test(t)) return { lat, lng, label, precision: 'area' };
  // "Dublin 2", "Dublin 6W", "D02 X285", "D6W"
  const d = t.match(/\bdublin (\d{1,2}w?)\b/) || t.match(/\bd(0?\d{1,2}|6w)\b/);
  if (d) {
    const k = d[1].replace(/^0/, '');
    if (DISTRICTS[k]) return { lat: DISTRICTS[k][0], lng: DISTRICTS[k][1], label: `Dublin ${k.toUpperCase()}`, precision: 'area' };
  }
  const e = String(text).toUpperCase().match(/\b([ACDEFHKNPRTVWXY]\d{2}|D6W)\s?[0-9ACDEFHKNPRTVWXY]{4}\b/);
  if (e && EIRCODES[e[1]]) { const [lat, lng, label] = EIRCODES[e[1]]; return { lat, lng, label, precision: 'area' }; }
  return null;
}
function findPlace(text) {
  const t = gnorm(text);
  for (const [re, lat, lng, label] of PLACE_RE) if (re.test(t)) return { lat, lng, label, precision: 'city' };
  if (/(^| )(dublin|co dublin|county dublin)( |$)/.test(t)) return { lat: DUBLIN[0], lng: DUBLIN[1], label: 'Dublin (area not stated)', precision: 'city' };
  return null;
}

// Where is this job? Location field first; for a city-only location, look in the description for
// a district or Eircode in that city. Returns null when nothing is known.
function locate(job) {
  const loc = job.location || '';
  if (/\bremote\b|home[- ]based|anywhere|worldwide/i.test(loc) && !/hybrid/i.test(loc)) return { precision: 'remote', label: 'Remote' };
  // job.area: the office area as stated in the posting (noted by the AI while scoring).
  const stated = job.area && (findArea(job.area) || findPlace(job.area));
  if (stated && stated.precision === 'area') return { ...stated, label: `${stated.label} (stated in the posting)` };
  const a = findArea(loc);
  if (a) return a;
  const p = findPlace(loc) || findPlace(job.title || '');
  if (p && p.label.startsWith('Dublin')) {
    const fromText = findArea((job.description || '').slice(0, 4000));
    if (fromText && Math.abs(fromText.lat - DUBLIN[0]) < 0.4 && Math.abs(fromText.lng - DUBLIN[1]) < 0.5) return { ...fromText, label: fromText.label + ' (from the job description)' };
  }
  return p;
}

module.exports = { locate, findArea, findPlace, DUBLIN };
