import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

const debounceMs = 300;

type Props = {
  /** The search text currently in the URL. */
  value: string;
  /** Called 300 ms after the last keystroke with the trimmed text; must be stable between renders. */
  onSearch: (text: string) => void;
  label: string;
  placeholder: string;
};

/**
 * Search field whose text lives in the URL. It keeps what is being typed locally, pushes it to the
 * URL after a pause, and follows the URL when that changes by itself (browser back and forward).
 */
export function SearchBox({ value, onSearch, label, placeholder }: Props) {
  const [text, setText] = useState(value);
  // The last text this box put into the URL, so its own update is not mistaken for navigation.
  const pushed = useRef(value);

  useEffect(() => {
    if (value === pushed.current) return;
    pushed.current = value;
    setText(value);
  }, [value]);

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === pushed.current) return;
    const timer = setTimeout(() => {
      pushed.current = trimmed;
      onSearch(trimmed);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [text, onSearch]);

  return (
    <div className="relative">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={text}
        maxLength={100}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        className="pl-10"
      />
    </div>
  );
}
