import { Link } from '@tanstack/react-router';
import { ScanLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BottomBar } from '@/components/bottom-bar';
import { Button } from '@/components/ui/button';
import { coarsePointer, useMediaQuery } from '@/lib/use-media-query';

/**
 * The way into the scanner: "Skenovat" in the bottom bar of a phone. A computer has no camera to
 * speak of, so there it is not offered; `withNote` says so in its place (the overview does).
 * Whoever renders it decides who may see it (a writer, on a run in progress).
 * `locationId` is the checklist the scanner is opened from, none for the run as a whole.
 */
export function ScanEntry({
  inventoryId,
  locationId,
  withNote = false,
}: {
  inventoryId: string;
  locationId?: string;
  withNote?: boolean;
}) {
  const { t } = useTranslation();
  const touch = useMediaQuery(coarsePointer);

  if (!touch) {
    return withNote ? <p className="text-center text-sm text-muted-foreground">{t('inventory.scanOnPhone')}</p> : null;
  }
  return (
    <BottomBar>
      <Button asChild className="w-full">
        <Link to="/inventories/$id/scan" params={{ id: inventoryId }} search={{ locationId }}>
          <ScanLine aria-hidden />
          {t('inventory.actions.scan')}
        </Link>
      </Button>
    </BottomBar>
  );
}
