import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../src/components/ui/button.tsx';
import { renderApp } from './helpers.tsx';

describe('App', () => {
  it('shows the shell and the home route', async () => {
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Přehled' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('Evidence majetku');
    expect(screen.getByRole('link', { name: 'Přeskočit na obsah' })).toHaveAttribute(
      'href',
      '#content',
    );
  });

  it('answers an unknown URL with a Czech not-found page that links home', async () => {
    renderApp('/neexistuje');
    expect(await screen.findByText('Stránka nenalezena')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zpět na úvodní stránku' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});

describe('Button', () => {
  it('fires onClick and is at least 44 px tall by default', async () => {
    const onClick = vi.fn();
    const { render } = await import('@testing-library/react');
    render(<Button onClick={onClick}>Uložit</Button>);
    const button = screen.getByRole('button', { name: 'Uložit' });
    expect(button).toHaveClass('h-11');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
