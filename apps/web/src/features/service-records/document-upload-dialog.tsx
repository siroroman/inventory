import { useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatFileSize } from '@/lib/format';
import { ApiError } from '@/lib/api';
import { problemMessage } from '@/lib/problem';
import { invalidateAfterWrite } from '@/lib/query';
import { fileProblem } from './document-files';
import { uploadDocument } from './document-upload';

/** A file the user picked and the name it will get. */
export type PickedFile = { file: File; name: string };

type Row = PickedFile & {
  id: number;
  /** Why this file can never be uploaded (its type or size); it is shown but skipped. */
  blocked: string | null;
  status: 'ready' | 'uploading' | 'done' | 'error';
  error: string | null;
};

const MAX_NAME = 200;

function UploadRow({
  row,
  busy,
  onName,
  onRemove,
  nameError,
}: {
  row: Row;
  busy: boolean;
  onName: (name: string) => void;
  onRemove: () => void;
  nameError: string | null;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const errorId = useId();
  const message = row.blocked ?? row.error ?? nameError;
  return (
    <li className="flex items-start gap-2 rounded-md border p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <label htmlFor={inputId} className="min-w-0 font-medium break-words">
            {row.file.name}
          </label>
          <span className="shrink-0 text-muted-foreground">{formatFileSize(row.file.size)}</span>
        </div>
        <Input
          id={inputId}
          value={row.name}
          maxLength={MAX_NAME + 20}
          disabled={busy || row.status === 'done' || row.blocked !== null}
          aria-invalid={message !== null && row.status !== 'uploading'}
          aria-describedby={message ? errorId : undefined}
          onChange={(event) => onName(event.target.value)}
        />
        <p aria-live="polite" className="min-h-5 text-sm">
          {row.status === 'uploading' && <span className="text-muted-foreground">{t('serviceRecordDocuments.status.uploading')}</span>}
          {row.status === 'done' && (
            <span className="inline-flex items-center gap-1 text-foreground">
              <Check aria-hidden className="size-4" />
              {t('serviceRecordDocuments.status.done')}
            </span>
          )}
          {row.status !== 'uploading' && row.status !== 'done' && message && (
            <span id={errorId} className="text-destructive">
              {message}
            </span>
          )}
        </p>
      </div>
      {row.status !== 'done' && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label={t('serviceRecordDocuments.remove', { name: row.file.name })}
          onClick={onRemove}
        >
          <X aria-hidden />
        </Button>
      )}
    </li>
  );
}

/**
 * Lists the picked files with an editable name each and uploads them one after another. A file
 * that fails stays in the list with its reason, so the rest are not lost and it can be retried.
 * While files are going up the dialog cannot be closed.
 */
export function DocumentUploadDialog({
  recordId,
  picked,
  onClose,
}: {
  recordId: string;
  picked: PickedFile[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[]>(() =>
    picked.map((p, id) => {
      const problem = fileProblem(p.file);
      return { ...p, id, blocked: problem && problemMessage(new ApiError(problem, 0)), status: 'ready', error: null };
    }),
  );

  const patch = (id: number, change: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...change } : row)));
  const remove = (id: number) => {
    const rest = rows.filter((row) => row.id !== id);
    if (rest.length === 0) onClose();
    else setRows(rest);
  };

  const nameError = (row: Row) => {
    const name = row.name.trim();
    if (name.length === 0) return t('serviceRecordDocuments.nameRequired');
    return name.length > MAX_NAME ? t('serviceRecordDocuments.nameTooLong') : null;
  };
  const waiting = rows.filter((row) => row.blocked === null && row.status !== 'done');
  const canUpload = !busy && waiting.length > 0 && waiting.every((row) => nameError(row) === null);
  const retrying = waiting.some((row) => row.status === 'error');

  async function upload() {
    setBusy(true);
    let saved = 0;
    let failed = 0;
    for (const row of waiting) {
      patch(row.id, { status: 'uploading', error: null });
      try {
        await uploadDocument(recordId, row.file, row.name.trim());
        patch(row.id, { status: 'done' });
        saved++;
      } catch (error) {
        patch(row.id, { status: 'error', error: problemMessage(error) });
        failed++;
      }
    }
    setBusy(false);
    // The ones that made it show in the list behind the dialog, also when others failed.
    if (saved > 0) {
      toast.success(t('common.saved'));
      await invalidateAfterWrite(queryClient);
    }
    if (failed === 0 && rows.every((row) => row.blocked === null)) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent closable={!busy}>
        <DialogTitle>{t('serviceRecordDocuments.uploadTitle')}</DialogTitle>
        <DialogDescription>{t('serviceRecordDocuments.uploadHint')}</DialogDescription>
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <UploadRow
              key={row.id}
              row={row}
              busy={busy}
              nameError={row.status === 'ready' || row.status === 'error' ? nameError(row) : null}
              onName={(name) => patch(row.id, { name })}
              onRemove={() => remove(row.id)}
            />
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={!canUpload} onClick={() => void upload()}>
            {retrying ? t('serviceRecordDocuments.retryAction') : t('serviceRecordDocuments.uploadAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
