import { createFileRoute, type HistoryState, redirect } from '@tanstack/react-router';
import { AppShell } from '@/components/app-shell';
import { currentUser } from '@/features/auth/api';
import { ApiError } from '@/lib/api';

// Layout for every screen that needs a signed-in user. Anyone else is sent to the login page and
// comes back to the URL they asked for. Other failures (server down) reach the route's error
// screen with its retry button instead of looking like a sign-out. The redirect says the session
// was just found missing (`state.anonymous`), so the login page does not ask the server again.
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    try {
      await currentUser(context.queryClient);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'unauthenticated') {
        throw redirect({ to: '/login', search: { redirect: location.href }, state: { anonymous: true } as HistoryState });
      }
      throw error;
    }
  },
  component: AppShell,
});
