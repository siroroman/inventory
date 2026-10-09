import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AvatarStack } from '../src/components/avatar.tsx';
import { Progress } from '../src/components/ui/progress.tsx';

describe('Progress', () => {
  it('names itself and reports the numbers', () => {
    render(<Progress value={84} max={128} label="Průběh" />);
    const bar = screen.getByRole('progressbar', { name: 'Průběh' });
    expect(bar).toHaveAttribute('aria-valuenow', '84');
    expect(bar).toHaveAttribute('aria-valuemax', '128');
    expect(bar.firstElementChild).toHaveStyle({ width: '66%' });
  });

  it('is empty when there is nothing to measure and never passes full', () => {
    const { rerender } = render(<Progress value={0} max={0} label="Průběh" />);
    expect(screen.getByRole('progressbar').firstElementChild).toHaveStyle({ width: '0%' });
    rerender(<Progress value={9} max={5} label="Průběh" />);
    expect(screen.getByRole('progressbar').firstElementChild).toHaveStyle({ width: '100%' });
  });
});

describe('AvatarStack', () => {
  const people = ['Roman Siro', 'Jan Novák', 'Petra Čtenářová', 'Karel Dvořák', 'Eva Malá', 'Ivo Starý'].map((name) => ({
    id: name,
    name,
  }));

  it('draws the first people as initials and the rest as a count, and names everybody for a screen reader', () => {
    render(<AvatarStack people={people} />);
    expect(screen.getByText('RS')).toBeInTheDocument();
    expect(screen.getByText('KD')).toBeInTheDocument();
    expect(screen.queryByText('EM')).not.toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText(people.map((p) => p.name).join(', '))).toHaveClass('sr-only');
  });

  it('draws nothing for nobody', () => {
    const { container } = render(<AvatarStack people={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
