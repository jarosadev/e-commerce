import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="px-4 lg:px-6 h-14 flex items-center">
        <Link className="flex items-center justify-center" href="/">
          <span className="font-bold text-xl">SaaS E-Commerce</span>
        </Link>
        <nav className="ml-auto flex gap-4 sm:gap-6">
          <Link className="text-sm font-medium hover:underline underline-offset-4" href="/#plans">
            Plans
          </Link>
          <Link className="text-sm font-medium hover:underline underline-offset-4" href="/login">
            Login
          </Link>
          <Button onClick={() => window.location.href = '/register'}>Register</Button>
        </nav>
      </header>
      <main className="flex-1">
        <section className="w-full py-12 md:py-24 lg:py-32 xl:py-48">
          <div className="container px-4 md:px-6">
            <div className="flex flex-col items-center space-y-4 text-center">
              <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl lg:text-6xl">
                Build your store in minutes
              </h1>
              <p className="mx-auto max-w-[700px] text-gray-500 md:text-xl dark:text-gray-400">
                The multi-tenant e-commerce solution for B2B and B2C.
              </p>
              <Button onClick={() => window.location.href = '/register'}>Get Started</Button>
            </div>
          </div>
        </section>
        <section id="plans" className="w-full py-12 md:py-24 lg:py-32 bg-gray-100 dark:bg-gray-800">
          <div className="container px-4 md:px-6">
            <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl text-center mb-12">Plans</h2>
            {/* Plans List will go here - fetch from API in next step */}
          </div>
        </section>
      </main>
    </div>
  );
}
