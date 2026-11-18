import { Suspense } from 'react';
import { headers } from 'next/headers';

async function StoreContent({ paramsPromise }: { paramsPromise: Promise<{ domain: string }> }) {
  const params = await paramsPromise;
  const domain = params.domain;
  const headersList = await headers();
  // Pass the host header through
  const tenantHost = headersList.get('x-tenant-host') || `${domain}.localhost:3000`;

  const res = await fetch(`http://localhost:4000/api/v1/storefront/products`, {
    headers: {
      'x-tenant-host': tenantHost,
      'Content-Type': 'application/json',
    },
    cache: 'no-store', // Disable cache for SSR
  });

  if (!res.ok) return <div className="p-8">Error loading products: {res.statusText}</div>;
  const data = await res.json();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Store: {domain}</h1>
      <div className="grid grid-cols-3 gap-4">
        {data.items.map((product: any) => (
          <div key={product.id} className="border p-4 rounded shadow">
            <h2 className="font-semibold">{product.name}</h2>
            <p className="text-sm text-gray-600">{product.slug}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StorefrontPage(props: { params: Promise<{ domain: string }> }) {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <StoreContent paramsPromise={props.params} />
    </Suspense>
  );
}
