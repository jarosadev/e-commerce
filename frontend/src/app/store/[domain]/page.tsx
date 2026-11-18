import { Suspense } from 'react';

async function StoreContent({ paramsPromise }: { paramsPromise: Promise<{ domain: string }> }) {
  const params = await paramsPromise;
  return <div className="p-8"><h1>Store: {params.domain}</h1></div>;
}

export default function StorefrontPage(props: { params: Promise<{ domain: string }> }) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StoreContent paramsPromise={props.params} />
    </Suspense>
  );
}
