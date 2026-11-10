export type CategoryInput = {
  breadcrumbs: string[];
  url?: string;
  title?: string;
};

export type MappedCategory = {
  group: string;
  subgroup: string;
};

type Rule = {
  test: (input: CategoryInput) => boolean;
  group: string;
  subgroup: string;
};

function tokens(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function padded(s: string): string {
  const t = tokens(s);
  return t ? ` ${t} ` : ' ';
}

function hayHas(hay: string, needle: string): boolean {
  const n = padded(needle);
  return n !== ' ' && padded(hay).includes(n);
}

function crumbs(input: CategoryInput): string[] {
  return input.breadcrumbs.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function crumbHas(input: CategoryInput, ...needles: string[]): boolean {
  return crumbs(input).some((c) => needles.some((n) => hayHas(c, n)));
}

function urlText(input: CategoryInput): string {
  return (input.url ?? '').toLowerCase();
}

function urlHas(input: CategoryInput, ...needles: string[]): boolean {
  const u = urlText(input);
  return needles.some((n) => u.includes(n.toLowerCase()));
}

function urlTokenHas(input: CategoryInput, ...needles: string[]): boolean {
  const hay = padded(urlText(input).replace(/[/?#]/g, ' '));
  return needles.some((n) => hay.includes(padded(n)) && padded(n) !== ' ');
}

/** Breadcrumb segments or URL path tokens / hyphenated prefixes. */
function anywhere(input: CategoryInput, ...needles: string[]): boolean {
  if (crumbHas(input, ...needles) || urlTokenHas(input, ...needles)) return true;
  return needles.some((n) => urlHas(input, `/${n.toLowerCase().replace(/\s+/g, '-')}`));
}

function isMonitor(input: CategoryInput): boolean {
  return anywhere(input, 'monitor');
}

function isGaming(input: CategoryInput): boolean {
  if (/gaming/i.test(input.title ?? '')) return true;
  return crumbs(input).some((c) => /gaming/i.test(c));
}

function isNetworking(input: CategoryInput): boolean {
  return anywhere(input, 'networking', 'network');
}

const OUT: Array<(input: CategoryInput) => boolean> = [
  (i) => anywhere(i, 'air conditioner'),
  (i) => anywhere(i, 'refrigerator'),
  (i) => anywhere(i, 'television'),
  (i) => anywhere(i, 'mobile phone'),
  (i) => anywhere(i, 'air fryer'),
  (i) => anywhere(i, 'trimmer'),
  (i) => anywhere(i, 'drone'),
  (i) => anywhere(i, 'lifestyle'),
  (i) => anywhere(i, 'solar'),
  (i) => anywhere(i, 'portable power'),
];

const RULES: Rule[] = [
  { test: (i) => anywhere(i, 'processor'), group: 'Components', subgroup: 'Processors' },
  { test: (i) => anywhere(i, 'motherboard'), group: 'Components', subgroup: 'Motherboards' },
  {
    test: (i) => anywhere(i, 'ram', 'laptop ram') || urlHas(i, '/component/laptop-ram', '/component/ram'),
    group: 'Components',
    subgroup: 'Memory',
  },
  { test: (i) => anywhere(i, 'graphics card'), group: 'Components', subgroup: 'Graphics Cards' },
  { test: (i) => anywhere(i, 'power supply'), group: 'Components', subgroup: 'Power Supplies' },
  { test: (i) => anywhere(i, 'cpu cooler'), group: 'Components', subgroup: 'Cooling' },
  { test: (i) => anywhere(i, 'casing', 'casings'), group: 'Components', subgroup: 'Casings' },

  { test: (i) => anywhere(i, 'ssd') || urlHas(i, '/component/ssd'), group: 'Storage', subgroup: 'Solid State Drives' },
  { test: (i) => anywhere(i, 'hdd', 'hard disk'), group: 'Storage', subgroup: 'Hard Drives' },
  { test: (i) => anywhere(i, 'pen drive'), group: 'Storage', subgroup: 'Flash Drives' },
  { test: (i) => anywhere(i, 'memory card'), group: 'Storage', subgroup: 'Memory Cards' },

  { test: (i) => anywhere(i, 'gaming laptop'), group: 'Laptop', subgroup: 'Gaming' },
  { test: (i) => anywhere(i, 'ultrabook'), group: 'Laptop', subgroup: 'Ultrabook' },
  { test: (i) => anywhere(i, 'laptop accessories'), group: 'Laptop', subgroup: 'Accessories' },
  { test: (i) => anywhere(i, 'laptop', 'notebook'), group: 'Laptop', subgroup: 'Notebook' },

  { test: (i) => anywhere(i, 'brand pc'), group: 'Desktop', subgroup: 'Brand PC' },
  { test: (i) => anywhere(i, 'gaming pc'), group: 'Desktop', subgroup: 'Gaming PC' },
  { test: (i) => anywhere(i, 'mini pc'), group: 'Desktop', subgroup: 'Mini PC' },
  { test: (i) => anywhere(i, 'all in one', 'aio'), group: 'Desktop', subgroup: 'All-in-One' },

  { test: (i) => anywhere(i, 'headset', 'headphone', 'speaker'), group: 'Peripherals', subgroup: 'Audio' },
  { test: (i) => isMonitor(i) && isGaming(i), group: 'Monitors', subgroup: 'Gaming' },
  { test: (i) => isMonitor(i), group: 'Monitors', subgroup: 'Office' },

  { test: (i) => anywhere(i, 'keyboard', 'mouse'), group: 'Peripherals', subgroup: 'Input Devices' },
  { test: (i) => anywhere(i, 'webcam'), group: 'Peripherals', subgroup: 'Cameras' },
  { test: (i) => anywhere(i, 'printer', 'scanner'), group: 'Peripherals', subgroup: 'Printers' },

  { test: (i) => isNetworking(i) && anywhere(i, 'cable'), group: 'Networking', subgroup: 'Cables' },
  { test: (i) => anywhere(i, 'router'), group: 'Networking', subgroup: 'Routers' },
  { test: (i) => anywhere(i, 'switch'), group: 'Networking', subgroup: 'Switches' },
  {
    test: (i) => anywhere(i, 'lan adapter') || (isNetworking(i) && anywhere(i, 'adapter')),
    group: 'Networking',
    subgroup: 'Adapters',
  },

  { test: (i) => anywhere(i, 'ups'), group: 'Power', subgroup: 'UPS' },

  {
    test: (i) => anywhere(i, 'hdmi cable', 'usb cable', 'power cable'),
    group: 'Accessories',
    subgroup: 'Cables',
  },
  { test: (i) => anywhere(i, 'hub'), group: 'Accessories', subgroup: 'Adapters' },
];

export function mapCategory(input: CategoryInput): MappedCategory | null {
  if (OUT.some((test) => test(input))) return null;
  const hit = RULES.find((rule) => rule.test(input));
  return hit ? { group: hit.group, subgroup: hit.subgroup } : null;
}
