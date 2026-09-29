import { QueryClientProvider, useMutation } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Toaster } from '../src/components/ui/sonner.tsx';
import { ApiError } from '../src/lib/api.ts';
import { createQueryClient } from '../src/lib/query.ts';

function Save({ code, silent = false }: { code: 'conflict' | 'forbidden'; silent?: boolean }) {
  const save = useMutation({
    mutationFn: async () => {
      throw new ApiError(code, code === 'conflict' ? 409 : 403);
    },
    meta: { silentError: silent },
  });
  return (
    <button type="button" onClick={() => save.mutate()}>
      Uložit
    </button>
  );
}

// sonner keeps its toasts in a module-level store, so each test uses its own error code.
function renderSave(code: 'conflict' | 'forbidden', silent?: boolean) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Save code={code} silent={silent} />
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('mutation errors', () => {
  it('toast the Czech message of the error code', async () => {
    renderSave('conflict');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findByText(/Záznam mezitím někdo upravil/)).toBeInTheDocument();
  });

  it('stay silent when the mutation shows the error itself', async () => {
    renderSave('forbidden', true);
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('K této akci nemáte oprávnění.')).not.toBeInTheDocument();
  });
});
