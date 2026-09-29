import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { Toaster } from '@/components/ui/sonner';
import type { AppRouter } from './router.tsx';

export function App({ router, queryClient }: { router: AppRouter; queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
}
