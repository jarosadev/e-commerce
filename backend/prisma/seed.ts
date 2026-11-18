import {
  BillingCycle,
  CustomerTier,
  DiscountType,
  PaymentReviewStatus,
  PlatformRole,
  PrismaClient,
  StorePaymentType,
  SubscriptionPaymentProvider,
  SubscriptionStatus,
  TenantMemberRole,
  TenantStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando seed de la plataforma SaaS Multi-Tienda...');

  const [adminHash, ownerHash, buyerHash] = await Promise.all([
    argon2.hash('Admin1234!'),
    argon2.hash('Owner1234!'),
    argon2.hash('Buyer1234!'),
  ]);

  // 1. Planes SaaS
  const planStarter = await prisma.plan.upsert({
    where: { code: 'EMPRENDEDOR' },
    update: {},
    create: {
      code: 'EMPRENDEDOR',
      name: 'Plan Emprendedor',
      description: 'Ideal para lanzar tu tienda online propia con carrito y gestión de pedidos.',
      priceMonthly: 19.0,
      priceYearly: 190.0,
      maxProducts: 100,
      maxStaff: 1,
      allowCustomDomain: false,
      allowCsvImport: false,
      allowAbandonedCart: false,
      allowWholesale: true,
      allowCoupons: true,
      sortOrder: 1,
    },
  });

  const planPro = await prisma.plan.upsert({
    where: { code: 'CRECIMIENTO_PRO' },
    update: {},
    create: {
      code: 'CRECIMIENTO_PRO',
      name: 'Plan Crecimiento Pro',
      description:
        'Dominio propio, importador Excel/CSV, mayorista B2B avanzado y recuperación de carritos.',
      priceMonthly: 49.0,
      priceYearly: 490.0,
      maxProducts: 1500,
      maxStaff: 3,
      allowCustomDomain: true,
      allowCsvImport: true,
      allowAbandonedCart: true,
      allowWholesale: true,
      allowCoupons: true,
      sortOrder: 2,
    },
  });

  await prisma.plan.upsert({
    where: { code: 'MAYORISTA_ENTERPRISE' },
    update: {},
    create: {
      code: 'MAYORISTA_ENTERPRISE',
      name: 'Plan Mayorista / Enterprise',
      description:
        'Sin límite práctico de catálogo, equipo extendido y automatizaciones completas B2B + B2C.',
      priceMonthly: 99.0,
      priceYearly: 990.0,
      maxProducts: 50000,
      maxStaff: 10,
      allowCustomDomain: true,
      allowCsvImport: true,
      allowAbandonedCart: true,
      allowWholesale: true,
      allowCoupons: true,
      sortOrder: 3,
    },
  });

  // 2. Usuario SuperAdmin SaaS
  await prisma.platformUser.upsert({
    where: { email: 'admin@vendexa.local' },
    update: {},
    create: {
      email: 'admin@vendexa.local',
      passwordHash: adminHash,
      fullName: 'Super Administrador SaaS',
      role: PlatformRole.SUPER_ADMIN,
      emailVerifiedAt: new Date(),
    },
  });

  // 3. Cliente Dueño de Tienda #1 (con ficha CRM completa + Tienda B2C/B2B activa)
  const owner1 = await prisma.platformUser.upsert({
    where: { email: 'carlos@urbanthreads.local' },
    update: {},
    create: {
      email: 'carlos@urbanthreads.local',
      passwordHash: ownerHash,
      fullName: 'Carlos Mendoza',
      role: PlatformRole.STORE_OWNER,
      emailVerifiedAt: new Date(),
      ownerProfile: {
        create: {
          legalName: 'Urban Threads Textil S.R.L.',
          taxId: '20-60884412-9',
          phoneWhatsapp: '+5491145550199',
          country: 'Argentina',
          city: 'Buenos Aires',
          fiscalAddress: 'Av. Avellaneda 2840, Piso 2',
          businessCategory: 'Indumentaria & Calzado Urbano (Minorista + Mayorista)',
          acquisitionSource: 'Instagram B2B',
          internalAdminNotes:
            'Cliente puntual en pagos. Interesado en conectar dominio propio el próximo mes.',
          onboardingCompleted: true,
        },
      },
    },
  });

  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + 30);

  const store1 = await prisma.tenant.upsert({
    where: { slug: 'moda-mayorista' },
    update: {},
    create: {
      slug: 'moda-mayorista',
      name: 'Urban Threads Studio',
      description:
        'Indumentaria premium urbana y equipamiento diario. Venta directa y precios escalonados para mayoristas.',
      ownerId: owner1.id,
      status: TenantStatus.ACTIVE,
      currency: 'USD',
      whatsappSalesNumber: '5491145550199',
      contactEmail: 'ventas@urbanthreads.local',
      minWholesaleQty: 6,
      minWholesaleAmount: 120.0,
      members: {
        create: {
          userId: owner1.id,
          role: TenantMemberRole.OWNER,
        },
      },
      theme: {
        create: {
          primaryColor: '#0F172A',
          accentColor: '#4F46E5',
          darkModeDefault: false,
          heroTitle: 'Colección cápsula B2C & Mayorista 2026',
          heroSubtitle:
            'Combina tallas y colores: precios mayoristas automáticos desde 6 unidades en tu carrito.',
          announcementText:
            'Envío gratis en compras mayores a 120 USD · Descuentos por volumen activados en vivo',
        },
      },
      subscription: {
        create: {
          planId: planPro.id,
          billingCycle: BillingCycle.MONTHLY,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: periodEnd,
          payments: {
            create: {
              provider: SubscriptionPaymentProvider.MANUAL_TRANSFER,
              amount: 49.0,
              currency: 'USD',
              externalReference: 'TRF-992814',
              reviewStatus: PaymentReviewStatus.APPROVED,
              paidAt: new Date(),
            },
          },
        },
      },
    },
  });

  // Categorías y Productos Demo de la Tienda #1
  const catApparel = await prisma.category.upsert({
    where: {
      tenantId_slug: { tenantId: store1.id, slug: 'hoodies-poleras' },
    },
    update: {},
    create: {
      tenantId: store1.id,
      name: 'Hoodies & Poleras Heavyweight',
      slug: 'hoodies-poleras',
      sortOrder: 1,
    },
  });

  const catFootwear = await prisma.category.upsert({
    where: {
      tenantId_slug: { tenantId: store1.id, slug: 'calzado-urbano' },
    },
    update: {},
    create: {
      tenantId: store1.id,
      name: 'Calzado Urbano',
      slug: 'calzado-urbano',
      sortOrder: 2,
    },
  });

  const catAccessories = await prisma.category.upsert({
    where: {
      tenantId_slug: { tenantId: store1.id, slug: 'accesorios-mochilas' },
    },
    update: {},
    create: {
      tenantId: store1.id,
      name: 'Mochilas & Accesorios',
      slug: 'accesorios-mochilas',
      sortOrder: 3,
    },
  });

  const existingProductsCount = await prisma.product.count({
    where: { tenantId: store1.id },
  });

  if (existingProductsCount === 0) {
    await prisma.product.create({
      data: {
        tenantId: store1.id,
        categoryId: catApparel.id,
        name: 'Hoodie Boxy Heavyweight 450gsm',
        slug: 'hoodie-boxy-heavyweight-450gsm',
        shortDescription:
          'Algodón peinado 450gsm con caída estructurada. Ideal para marcas y retail.',
        description:
          'Confeccionado en felpa francesa 100% algodón de alto gramaje, costuras reforzadas y pre-encogido industrial.',
        brand: 'Urban Threads',
        isFeatured: true,
        minOrderQty: 1,
        images: {
          create: [
            {
              tenantId: store1.id,
              url: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=80',
              altText: 'Hoodie Boxy Negro',
              sortOrder: 0,
            },
          ],
        },
        variants: {
          create: [
            {
              tenantId: store1.id,
              sku: 'UT-HD-BLK-M',
              title: 'Talla M · Negro Ónix',
              attributes: { talla: 'M', color: 'Negro Ónix' },
              retailPrice: 42.0,
              compareAtPrice: 52.0,
              stockOnHand: 85,
            },
            {
              tenantId: store1.id,
              sku: 'UT-HD-BLK-L',
              title: 'Talla L · Negro Ónix',
              attributes: { talla: 'L', color: 'Negro Ónix' },
              retailPrice: 42.0,
              compareAtPrice: 52.0,
              stockOnHand: 110,
            },
            {
              tenantId: store1.id,
              sku: 'UT-HD-SND-L',
              title: 'Talla L · Arena Piedra',
              attributes: { talla: 'L', color: 'Arena Piedra' },
              retailPrice: 42.0,
              compareAtPrice: 52.0,
              stockOnHand: 60,
            },
          ],
        },
        wholesaleTiers: {
          create: [
            {
              tenantId: store1.id,
              minQuantity: 6,
              maxQuantity: 11,
              unitPrice: 33.0,
              label: 'Media Docena (-21%)',
            },
            {
              tenantId: store1.id,
              minQuantity: 12,
              maxQuantity: null,
              unitPrice: 26.5,
              label: 'Docena Mayorista (-37%)',
            },
          ],
        },
      },
    });

    await prisma.product.create({
      data: {
        tenantId: store1.id,
        categoryId: catFootwear.id,
        name: 'Sneaker Minimal Court Leather',
        slug: 'sneaker-minimal-court-leather',
        shortDescription: 'Cuero vegano microfibra de alta resistencia con plantilla ortopédica.',
        brand: 'Urban Threads',
        isFeatured: true,
        minOrderQty: 1,
        images: {
          create: [
            {
              tenantId: store1.id,
              url: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=900&q=80',
              altText: 'Sneaker Minimal Court',
              sortOrder: 0,
            },
          ],
        },
        variants: {
          create: [
            {
              tenantId: store1.id,
              sku: 'UT-SNK-WHT-41',
              title: 'Talla 41 · Blanco / Gris',
              attributes: { talla: '41', color: 'Blanco / Gris' },
              retailPrice: 68.0,
              compareAtPrice: 80.0,
              stockOnHand: 44,
            },
            {
              tenantId: store1.id,
              sku: 'UT-SNK-WHT-42',
              title: 'Talla 42 · Blanco / Gris',
              attributes: { talla: '42', color: 'Blanco / Gris' },
              retailPrice: 68.0,
              compareAtPrice: 80.0,
              stockOnHand: 52,
            },
          ],
        },
        wholesaleTiers: {
          create: [
            {
              tenantId: store1.id,
              minQuantity: 6,
              maxQuantity: 17,
              unitPrice: 54.0,
              label: 'Curva 6 pares (-20%)',
            },
            {
              tenantId: store1.id,
              minQuantity: 18,
              maxQuantity: null,
              unitPrice: 46.0,
              label: 'Caja 18 pares (-32%)',
            },
          ],
        },
      },
    });

    await prisma.product.create({
      data: {
        tenantId: store1.id,
        categoryId: catAccessories.id,
        name: 'Mochila Commuter Impermeable 24L',
        slug: 'mochila-commuter-impermeable-24l',
        shortDescription:
          'Compartimento acolchado para laptop 16", cierres sellados YKK y puerto USB.',
        brand: 'Urban Gear',
        isFeatured: true,
        minOrderQty: 1,
        images: {
          create: [
            {
              tenantId: store1.id,
              url: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=80',
              altText: 'Mochila Commuter 24L',
              sortOrder: 0,
            },
          ],
        },
        variants: {
          create: [
            {
              tenantId: store1.id,
              sku: 'UG-BP-24L-GRF',
              title: 'Único · Grafito Mate',
              attributes: { capacidad: '24L', color: 'Grafito Mate' },
              retailPrice: 55.0,
              stockOnHand: 70,
            },
          ],
        },
        wholesaleTiers: {
          create: [
            {
              tenantId: store1.id,
              minQuantity: 5,
              maxQuantity: 14,
              unitPrice: 43.0,
              label: 'Pack 5+ uds (-22%)',
            },
            {
              tenantId: store1.id,
              minQuantity: 15,
              maxQuantity: null,
              unitPrice: 36.0,
              label: 'Distribuidor 15+ uds (-35%)',
            },
          ],
        },
      },
    });

    await prisma.storePaymentMethod.createMany({
      data: [
        {
          tenantId: store1.id,
          type: StorePaymentType.BANK_TRANSFER,
          title: 'Transferencia Bancaria Directa',
          instructions:
            'Transfiere el total y adjunta el comprobante PDF o captura para despacho prioritario.',
          accountDetailsJson: {
            banco: 'Banco Comercial Nacional',
            titular: 'Urban Threads Textil S.R.L.',
            alias: 'URBAN.THREADS.MAYOR',
            cuenta: '0012-9948271-09',
          },
          requiresReceipt: true,
        },
        {
          tenantId: store1.id,
          type: StorePaymentType.QR_CODE,
          title: 'Pago con QR Interoperable',
          instructions:
            'Escanea el código QR desde tu app bancaria o billetera y sube el comprobante.',
          requiresReceipt: true,
        },
        {
          tenantId: store1.id,
          type: StorePaymentType.CASH_ON_DELIVERY,
          title: 'Efectivo al Retirar en Showroom',
          instructions: 'Abona en mostrador dentro de las 48h de reservada tu orden.',
          requiresReceipt: false,
        },
      ],
    });

    await prisma.shippingZone.createMany({
      data: [
        {
          tenantId: store1.id,
          name: 'Envío Express Área Metropolitana',
          cities: ['Buenos Aires', 'CABA', 'Zona Norte', 'Zona Sur'],
          flatRate: 8.5,
          freeShippingThreshold: 120.0,
          isLocalPickup: false,
          estimatedDays: '24 a 48 hs hábiles',
        },
        {
          tenantId: store1.id,
          name: 'Retiro sin cargo en Showroom Central',
          cities: ['CABA'],
          flatRate: 0,
          isLocalPickup: true,
          pickupAddress: 'Av. Avellaneda 2840, Piso 2 (Lun a Vie 9 a 18h)',
          estimatedDays: 'Listo en 4 horas',
        },
      ],
    });

    await prisma.coupon.create({
      data: {
        tenantId: store1.id,
        code: 'BIENVENIDA10',
        discountType: DiscountType.PERCENTAGE,
        value: 10,
        minPurchaseAmount: 50,
      },
    });
  }

  // Comprador Demo registrado en Tienda #1
  await prisma.storeCustomer.upsert({
    where: {
      tenantId_email: {
        tenantId: store1.id,
        email: 'comprador@cliente.local',
      },
    },
    update: {},
    create: {
      tenantId: store1.id,
      email: 'comprador@cliente.local',
      passwordHash: buyerHash,
      fullName: 'Sofía Ramírez (Distribuidora)',
      phone: '+5491167778899',
      customerTier: CustomerTier.WHOLESALE_B2B,
      emailVerifiedAt: new Date(),
    },
  });

  // 4. Segundo Cliente Dueño de Tienda en Trial para enriquecer el CRM SuperAdmin
  const owner2 = await prisma.platformUser.upsert({
    where: { email: 'lucia@electrohogar.local' },
    update: {},
    create: {
      email: 'lucia@electrohogar.local',
      passwordHash: ownerHash,
      fullName: 'Lucía Paredes',
      role: PlatformRole.STORE_OWNER,
      emailVerifiedAt: new Date(),
      ownerProfile: {
        create: {
          legalName: 'ElectroHogar Importaciones S.A.',
          taxId: '30-71992201-4',
          phoneWhatsapp: '+5491132229900',
          country: 'Argentina',
          city: 'Córdoba',
          businessCategory: 'Pequeños Electrodomésticos & Hogar',
          acquisitionSource: 'Landing Orgánica',
          internalAdminNotes:
            'En período de prueba de 14 días. Requiere capacitación de plantilla CSV.',
          onboardingCompleted: true,
        },
      },
    },
  });

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 14);

  await prisma.tenant.upsert({
    where: { slug: 'electro-hogar' },
    update: {},
    create: {
      slug: 'electro-hogar',
      name: 'ElectroHogar Directo',
      description: 'Tecnología y equipamiento para el hogar con garantía oficial.',
      ownerId: owner2.id,
      status: TenantStatus.TRIAL,
      currency: 'USD',
      whatsappSalesNumber: '5491132229900',
      members: {
        create: {
          userId: owner2.id,
          role: TenantMemberRole.OWNER,
        },
      },
      theme: {
        create: {
          primaryColor: '#09090B',
          accentColor: '#0EA5E9',
          heroTitle: 'Tecnología para tu hogar al mejor precio directo',
          heroSubtitle: 'Envíos asegurados a todo el país.',
        },
      },
      subscription: {
        create: {
          planId: planStarter.id,
          billingCycle: BillingCycle.MONTHLY,
          status: SubscriptionStatus.TRIALING,
          currentPeriodEnd: trialEnd,
        },
      },
    },
  });

  console.log('Seed completado exitosamente.');
}

main()
  .catch((err) => {
    console.error('Error ejecutando seed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
