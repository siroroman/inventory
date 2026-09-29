import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { Button } from '../src/components/ui/button.tsx';

describe('App', () => {
  it('renders the app name', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Evidence majetku' })).toBeInTheDocument();
  });
});

describe('Button', () => {
  it('fires onClick and is at least 44 px tall by default', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Uložit</Button>);
    const button = screen.getByRole('button', { name: 'Uložit' });
    expect(button).toHaveClass('h-11');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
