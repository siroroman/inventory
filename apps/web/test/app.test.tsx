import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../src/components/ui/button.tsx';
import { jsonResponse, renderApp, stubApi } from './helpers.tsx';

describe('App', () => {
  it('shows the shell and the home route', async () => {
    stubApi({
      'GET /api/v1/me': () =>
        jsonResponse({
          id: '0c6f5a4e-8f3b-4a8e-9a55-2f2b1b8a9c11',
          email: 'anna@example.test',
          name: 'Anna Nováková',
          role: 'read',
        }),
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Přehled' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('Správa majetku');
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
