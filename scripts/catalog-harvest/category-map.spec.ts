import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapCategory } from './category-map';

describe('mapCategory', () => {
  it('processor → Components/Processors', () => {
    assert.deepEqual(mapCategory({ breadcrumbs: ['Component', 'Processor'] }), {
      group: 'Components',
      subgroup: 'Processors',
    });
  });

  it("['Monitor', 'AOC'] → Monitors/Office", () => {
    assert.deepEqual(mapCategory({ breadcrumbs: ['Monitor', 'AOC'] }), {
      group: 'Monitors',
      subgroup: 'Office',
    });
  });

  it("['Monitor', 'AOC'] + gaming title → Monitors/Gaming", () => {
    assert.deepEqual(
      mapCategory({
        breadcrumbs: ['Monitor', 'AOC'],
        title: 'AOC 25G4K Gaming Monitor',
      }),
      { group: 'Monitors', subgroup: 'Gaming' },
    );
  });

  it('AC breadcrumb → null', () => {
    assert.equal(
      mapCategory({ breadcrumbs: ['Home Appliance', 'Air Conditioner'] }),
      null,
    );
  });

  it("unknown breadcrumb ['Something', 'Else'] → null", () => {
    assert.equal(mapCategory({ breadcrumbs: ['Something', 'Else'] }), null);
  });
});

describe('mapCategory locked hits', () => {
  const hits: Array<{
    name: string;
    input: { breadcrumbs: string[]; url?: string; title?: string };
    expected: { group: string; subgroup: string } | null;
  }> = [
    {
      name: 'Motherboard',
      input: { breadcrumbs: ['Component', 'Motherboard'] },
      expected: { group: 'Components', subgroup: 'Motherboards' },
    },
    {
      name: 'RAM',
      input: { breadcrumbs: ['Component', 'RAM'] },
      expected: { group: 'Components', subgroup: 'Memory' },
    },
    {
      name: 'laptop-ram url',
      input: { breadcrumbs: [], url: 'https://www.startech.com.bd/component/laptop-ram' },
      expected: { group: 'Components', subgroup: 'Memory' },
    },
    {
      name: 'Graphics Card',
      input: { breadcrumbs: ['Component', 'Graphics Card'] },
      expected: { group: 'Components', subgroup: 'Graphics Cards' },
    },
    {
      name: 'Power Supply',
      input: { breadcrumbs: ['Component', 'Power Supply'] },
      expected: { group: 'Components', subgroup: 'Power Supplies' },
    },
    {
      name: 'CPU Cooler',
      input: { breadcrumbs: ['Component', 'CPU Cooler'] },
      expected: { group: 'Components', subgroup: 'Cooling' },
    },
    {
      name: 'Casing → Casings (plural)',
      input: { breadcrumbs: ['Component', 'Casing'] },
      expected: { group: 'Components', subgroup: 'Casings' },
    },
    {
      name: 'SSD breadcrumb',
      input: { breadcrumbs: ['Component', 'SSD'] },
      expected: { group: 'Storage', subgroup: 'Solid State Drives' },
    },
    {
      name: 'SSD url',
      input: { breadcrumbs: [], url: 'https://www.startech.com.bd/component/ssd' },
      expected: { group: 'Storage', subgroup: 'Solid State Drives' },
    },
    {
      name: 'HDD',
      input: { breadcrumbs: ['Component', 'HDD'] },
      expected: { group: 'Storage', subgroup: 'Hard Drives' },
    },
    {
      name: 'Hard Disk',
      input: { breadcrumbs: ['Component', 'Hard Disk'] },
      expected: { group: 'Storage', subgroup: 'Hard Drives' },
    },
    {
      name: 'Pen Drive',
      input: { breadcrumbs: ['Pen Drive'] },
      expected: { group: 'Storage', subgroup: 'Flash Drives' },
    },
    {
      name: 'Memory Card',
      input: { breadcrumbs: ['Memory Card'] },
      expected: { group: 'Storage', subgroup: 'Memory Cards' },
    },
    {
      name: 'Gaming Laptop',
      input: { breadcrumbs: ['Laptop', 'Gaming Laptop'] },
      expected: { group: 'Laptop', subgroup: 'Gaming' },
    },
    {
      name: 'Ultrabook',
      input: { breadcrumbs: ['Laptop', 'Ultrabook'] },
      expected: { group: 'Laptop', subgroup: 'Ultrabook' },
    },
    {
      name: 'Laptop / Notebook',
      input: { breadcrumbs: ['Laptop', 'Laptop'] },
      expected: { group: 'Laptop', subgroup: 'Notebook' },
    },
    {
      name: 'Notebook crumb',
      input: { breadcrumbs: ['Laptop', 'Notebook'] },
      expected: { group: 'Laptop', subgroup: 'Notebook' },
    },
    {
      name: 'Laptop Accessories',
      input: { breadcrumbs: ['Laptop', 'Laptop Accessories'] },
      expected: { group: 'Laptop', subgroup: 'Accessories' },
    },
    {
      name: 'Brand PC',
      input: { breadcrumbs: ['Desktop', 'Brand PC'] },
      expected: { group: 'Desktop', subgroup: 'Brand PC' },
    },
    {
      name: 'Gaming PC',
      input: { breadcrumbs: ['Desktop', 'Gaming PC'] },
      expected: { group: 'Desktop', subgroup: 'Gaming PC' },
    },
    {
      name: 'Mini PC',
      input: { breadcrumbs: ['Desktop', 'Mini PC'] },
      expected: { group: 'Desktop', subgroup: 'Mini PC' },
    },
    {
      name: 'All in One',
      input: { breadcrumbs: ['Desktop', 'All in One'] },
      expected: { group: 'Desktop', subgroup: 'All-in-One' },
    },
    {
      name: 'AIO',
      input: { breadcrumbs: ['Desktop', 'AIO'] },
      expected: { group: 'Desktop', subgroup: 'All-in-One' },
    },
    {
      name: 'keyboard',
      input: { breadcrumbs: ['Accessories', 'Keyboard'] },
      expected: { group: 'Peripherals', subgroup: 'Input Devices' },
    },
    {
      name: 'mouse',
      input: { breadcrumbs: ['Accessories', 'Mouse'] },
      expected: { group: 'Peripherals', subgroup: 'Input Devices' },
    },
    {
      name: 'headset',
      input: { breadcrumbs: ['Accessories', 'Headset'] },
      expected: { group: 'Peripherals', subgroup: 'Audio' },
    },
    {
      name: 'speaker',
      input: { breadcrumbs: ['Accessories', 'Speaker'] },
      expected: { group: 'Peripherals', subgroup: 'Audio' },
    },
    {
      name: 'webcam',
      input: { breadcrumbs: ['Accessories', 'Webcam'] },
      expected: { group: 'Peripherals', subgroup: 'Cameras' },
    },
    {
      name: 'printer',
      input: { breadcrumbs: ['Printer'] },
      expected: { group: 'Peripherals', subgroup: 'Printers' },
    },
    {
      name: 'scanner',
      input: { breadcrumbs: ['Scanner'] },
      expected: { group: 'Peripherals', subgroup: 'Printers' },
    },
    {
      name: 'router',
      input: { breadcrumbs: ['Networking', 'Router'] },
      expected: { group: 'Networking', subgroup: 'Routers' },
    },
    {
      name: 'switch',
      input: { breadcrumbs: ['Networking', 'Switch'] },
      expected: { group: 'Networking', subgroup: 'Switches' },
    },
    {
      name: 'LAN adapter',
      input: { breadcrumbs: ['Networking', 'LAN Adapter'] },
      expected: { group: 'Networking', subgroup: 'Adapters' },
    },
    {
      name: 'networking cable',
      input: { breadcrumbs: ['Networking', 'Cable'] },
      expected: { group: 'Networking', subgroup: 'Cables' },
    },
    {
      name: 'UPS',
      input: { breadcrumbs: ['UPS'] },
      expected: { group: 'Power', subgroup: 'UPS' },
    },
    {
      name: 'HDMI cable',
      input: { breadcrumbs: ['Accessories', 'HDMI Cable'] },
      expected: { group: 'Accessories', subgroup: 'Cables' },
    },
    {
      name: 'USB cable',
      input: { breadcrumbs: ['Accessories', 'USB Cable'] },
      expected: { group: 'Accessories', subgroup: 'Cables' },
    },
    {
      name: 'power cable',
      input: { breadcrumbs: ['Accessories', 'Power Cable'] },
      expected: { group: 'Accessories', subgroup: 'Cables' },
    },
    {
      name: 'hub',
      input: { breadcrumbs: ['Accessories', 'Hub'] },
      expected: { group: 'Accessories', subgroup: 'Adapters' },
    },
    {
      name: 'air-conditioner url',
      input: { breadcrumbs: [], url: 'https://www.startech.com.bd/air-conditioner' },
      expected: null,
    },
    {
      name: 'refrigerator',
      input: { breadcrumbs: ['Home Appliance', 'Refrigerator'] },
      expected: null,
    },
    {
      name: 'television',
      input: { breadcrumbs: ['Television'] },
      expected: null,
    },
    {
      name: 'mobile phone',
      input: { breadcrumbs: ['Mobile Phone'] },
      expected: null,
    },
    {
      name: 'air fryer',
      input: { breadcrumbs: ['Home Appliance', 'Air Fryer'] },
      expected: null,
    },
    {
      name: 'trimmer',
      input: { breadcrumbs: ['Lifestyle', 'Trimmer'] },
      expected: null,
    },
    {
      name: 'drone',
      input: { breadcrumbs: ['Drone'] },
      expected: null,
    },
    {
      name: 'lifestyle',
      input: { breadcrumbs: ['Lifestyle'] },
      expected: null,
    },
    {
      name: 'solar',
      input: { breadcrumbs: ['Solar'] },
      expected: null,
    },
    {
      name: 'portable power',
      input: { breadcrumbs: ['Portable Power'] },
      expected: null,
    },
  ];

  for (const hit of hits) {
    it(hit.name, () => {
      assert.deepEqual(mapCategory(hit.input), hit.expected);
    });
  }
});
