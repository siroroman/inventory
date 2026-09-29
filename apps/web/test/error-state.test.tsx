import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState } from '../src/components/error-state.tsx';

describe('ErrorState', () => {
  it('announces the default Czech title and retries on click', async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Něco se nepovedlo');
    await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('has no retry button unless asked for one', () => {
    render(<ErrorState message="Server není dostupný." />);
    expect(screen.getByText('Server není dostupný.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
