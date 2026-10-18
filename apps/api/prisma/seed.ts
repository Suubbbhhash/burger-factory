// ============================================
// THE BURGER FACTORY — DATABASE SEED SCRIPT
// Populates 7 Outlets, 104 Tables, Menu, and Staff
// ============================================

import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { LOCATIONS } from '@burger-factory/shared';
import { locationTables, menuItems } from '../../../src/js/data.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting Burger Factory database seeding...');

  // 1. Seed Staff Users
  const passwordHash = await argon2.hash('GoaBurgers2026!');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@burgerfactory.in' },
    update: {},
    create: {
      email: 'admin@burgerfactory.in',
      name: 'Burger Factory Admin',
      passwordHash,
      role: 'ADMIN'
    }
  });

  const manager = await prisma.user.upsert({
    where: { email: 'manager@burgerfactory.in' },
    update: {},
    create: {
      email: 'manager@burgerfactory.in',
      name: 'Anjuna Floor Host',
      passwordHash,
      role: 'MANAGER'
    }
  });

  console.log('✓ Staff users seeded');

  // 2. Seed Locations & Tables
  for (const loc of LOCATIONS) {
    const createdLoc = await prisma.location.upsert({
      where: { slug: loc.slug },
      update: {
        name: loc.name,
        tag: loc.tag,
        area: loc.area,
        address: loc.address,
        phone: loc.phone,
        opensAt: loc.opensAt,
        lastSeatingAt: loc.lastSeatingAt,
        mapUrl: loc.mapUrl,
        image: loc.image,
        vibe: loc.vibe,
        features: [...loc.features]
      },
      create: {
        slug: loc.slug,
        name: loc.name,
        tag: loc.tag,
        area: loc.area,
        address: loc.address,
        phone: loc.phone,
        opensAt: loc.opensAt,
        lastSeatingAt: loc.lastSeatingAt,
        mapUrl: loc.mapUrl,
        image: loc.image,
        vibe: loc.vibe,
        features: [...loc.features]
      }
    });

    // Link manager to Anjuna
    if (loc.slug === 'anjuna') {
      await prisma.userLocation.upsert({
        where: { userId_locationId: { userId: manager.id, locationId: createdLoc.id } },
        update: {},
        create: { userId: manager.id, locationId: createdLoc.id }
      });
    }

    // Seed Tables for this Location
    const tablesMap = (locationTables as any)[loc.slug];
    if (tablesMap) {
      let gridX = 0;
      let gridY = 0;

      for (const [zoneKey, zoneTables] of Object.entries(tablesMap) as any) {
        const zoneEnum = zoneKey.toUpperCase() as 'INDOOR' | 'OUTDOOR' | 'BEACHSIDE';

        for (const t of zoneTables) {
          const isRound = t.type === '2-seater';

          await prisma.diningTable.upsert({
            where: { locationId_label: { locationId: createdLoc.id, label: t.id } },
            update: {
              zone: zoneEnum,
              capacity: t.capacity,
              shape: isRound ? 'round' : 'rect'
            },
            create: {
              locationId: createdLoc.id,
              label: t.id,
              zone: zoneEnum,
              capacity: t.capacity,
              posX: gridX,
              posY: gridY,
              width: isRound ? 2 : (t.capacity >= 6 ? 4 : 2),
              height: 2,
              shape: isRound ? 'round' : 'rect'
            }
          });

          gridX = (gridX + 2) % 12;
          if (gridX === 0) gridY += 2;
        }
      }
    }
  }

  console.log('✓ 7 Locations and 104 Tables seeded');

  // 3. Seed Menu Categories & Items
  const catNames: Record<string, string> = {
    beef: 'Gourmet Beef Burgers',
    chicken: 'Hand-Ground Chicken',
    veg: 'Scratch-Made Vegetarian',
    sides: 'Crispy Sides & Fries',
    shakes: 'Legendary Thick Shakes'
  };

  let sortOrder = 0;
  for (const [slug, name] of Object.entries(catNames)) {
    const category = await prisma.menuCategory.upsert({
      where: { slug },
      update: { name, sortOrder },
      create: { slug, name, sortOrder }
    });
    sortOrder++;

    const items = menuItems.filter(m => m.category === slug);
    for (const item of items) {
      const diet = item.category === 'veg' ? 'VEG' : 'NON_VEG';
      const badge = item.badge === 'popular' ? 'POPULAR' : (item.badge === 'new' ? 'NEW' : null);

      await prisma.menuItem.upsert({
        where: { slug: item.id },
        update: {
          name: item.name,
          description: item.description,
          pricePaise: item.price * 100, // converted to integer paise
          diet,
          badge,
          tags: item.tags,
          image: item.image
        },
        create: {
          categoryId: category.id,
          slug: item.id,
          name: item.name,
          description: item.description,
          pricePaise: item.price * 100,
          diet,
          badge,
          tags: item.tags,
          image: item.image
        }
      });
    }
  }

  console.log('✓ Menu Categories and Items seeded');
  console.log('✨ Database seeding complete!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
