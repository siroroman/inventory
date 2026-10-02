import type { DocumentDto } from '@inventory/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Download, Eye, FileSpreadsheet, FileText, Image as ImageIcon, Pencil, Trash2, Upload } from 'lucide-react';
import { type ChangeEvent, type FormEvent, type ReactNode, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ErrorState } from '@/components/error-state';
import { EmptyState } from '@/components/paged-list';
import { sectionTitleClass } from '@/components/section';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { formatDate, formatFileSize, formatTimestamp } from '@/lib/format';
import { problemMessage } from '@/lib/problem';
import { invalidateAfterWrite } from '@/lib/query';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import {
  deleteServiceRecordDocument,
  renameServiceRecordDocument,
  serviceRecordDocumentsQueryOptions,
} from './api';
import { defaultDocumentName, documentAccept, imageAccept } from './document-files';
import { DocumentUploadDialog, type PickedFile } from './document-upload-dialog';
import { today } from './service-record-form-values';

const MAX_NAME = 200;

function FileIcon({ contentType }: { contentType: string }) {
  const Icon = contentType.startsWith('image/') ? ImageIcon : contentType.includes('sheet') || contentType.includes('excel') ? FileSpreadsheet : FileText;
  return (
    <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <Icon className="size-5" />
    </span>
  );
}

function RenameDialog({ recordId, document, onClose }: { recordId: string; document: DocumentDto; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const nameId = useId();
  const errorId = useId();
  const [name, setName] = useState(document.name);
  const [conflict, setConflict] = useState(false);
  const trimmed = name.trim();
  const invalid = trimmed.length === 0 ? t('serviceRecordDocuments.nameRequired') : trimmed.length > MAX_NAME ? t('serviceRecordDocuments.nameTooLong') : null;

  // A version that moved on under us is fetched again; the user then saves a second time.
  const save = useMutation({
    mutationFn: () => renameServiceRecordDocument(recordId, document.id, { name: trimmed, version: document.version }),
    meta: { silentError: true },
    onSuccess: () => {
      toast.success(t('common.saved'));
      onClose();
    },
    onError: (error) => setConflict(error instanceof ApiError && error.code === 'conflict'),
    onSettled: () => invalidateAfterWrite(queryClient),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!invalid) save.mutate();
  };
  const failure = save.isError ? problemMessage(save.error) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent>
        <DialogTitle>{t('serviceRecordDocuments.renameTitle')}</DialogTitle>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-sm font-medium">
              {t('serviceRecordDocuments.nameLabel')}
            </label>
            <Input
              id={nameId}
              value={name}
              autoFocus
              aria-invalid={invalid !== null && name !== document.name}
              aria-describedby={invalid ? errorId : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {invalid && name !== document.name && (
              <p id={errorId} className="text-sm text-destructive">
                {invalid}
              </p>
            )}
          </div>
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending || invalid !== null}>
              {conflict ? t('serviceRecordDocuments.reload') : t('serviceRecordDocuments.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ recordId, document, onClose }: { recordId: string; document: DocumentDto; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteServiceRecordDocument(recordId, document.id),
    onSuccess: () => toast.success(t('common.saved')),
    onSettled: () => invalidateAfterWrite(queryClient),
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>{t('serviceRecordDocuments.deleteTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('serviceRecordDocuments.deleteHint', { name: document.name })}</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction className={cn(buttonVariants({ variant: 'destructive' }))} onClick={() => remove.mutate()}>
            {t('serviceRecordDocuments.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** What the viewer can show: the browser has a PDF viewer and shows pictures. Word and Excel files are only downloaded. */
const previewable = (contentType: string) => contentType === 'application/pdf' || contentType.startsWith('image/');

function DownloadButton({ document, size = 'icon' }: { document: DocumentDto; size?: 'icon' | 'sm' }) {
  const { t } = useTranslation();
  const label = t('serviceRecordDocuments.downloadLabel', { name: document.name });
  return (
    <Button asChild variant={size === 'icon' ? 'ghost' : 'outline'} size={size}>
      {/* The link is signed with Content-Disposition: attachment, so the browser saves the file. */}
      <a href={document.downloadUrl} download aria-label={label} title={label}>
        <Download aria-hidden />
        {size === 'sm' && t('serviceRecordDocuments.download')}
      </a>
    </Button>
  );
}

/** The document in the browser's own PDF viewer (or as a picture), without leaving the record. */
function DocumentViewer({ document, onClose }: { document: DocumentDto; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="h-[calc(100dvh-2rem)] max-w-5xl">
        <div className="flex items-center gap-3 pr-12">
          <DialogTitle className="min-w-0 flex-1 truncate pr-0">{document.name}</DialogTitle>
          <DownloadButton document={document} size="sm" />
        </div>
        <DialogDescription className="sr-only">{t('serviceRecordDocuments.viewerHint')}</DialogDescription>
        {document.contentType === 'application/pdf' ? (
          <iframe src={document.url} title={document.name} className="min-h-0 w-full flex-1 rounded-md border bg-background" />
        ) : (
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md border bg-muted">
            {/* A tap beside the picture closes the viewer. Keyboard users have Escape and the close button. */}
            <button type="button" aria-hidden tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-pointer" />
            <img src={document.url} alt={document.name} className="relative max-h-full max-w-full object-contain" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DocumentRow({
  document,
  canEdit,
  onView,
  onRename,
  onDelete,
}: {
  document: DocumentDto;
  canEdit: boolean;
  /** Opens the viewer; left out where the browser's own tab is the better viewer (touch screens) or the type has none. */
  onView: (() => void) | undefined;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const meta = [t('serviceRecordDocuments.added', { date: formatTimestamp(document.createdAt) }), document.createdBy?.name, formatFileSize(document.size)];
  return (
    // The buttons wrap under the name on a narrow screen.
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4">
      <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
        <FileIcon contentType={document.contentType} />
        <div className="min-w-0 flex-1">
          <a
            href={document.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[15px] font-medium break-words underline-offset-2 hover:underline focus-visible:underline"
          >
            {document.name}
          </a>
          <p className="text-sm text-muted-foreground">{meta.filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="-my-2 -mr-2 ml-auto flex shrink-0">
        {onView && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('serviceRecordDocuments.viewLabel', { name: document.name })}
            title={t('serviceRecordDocuments.viewLabel', { name: document.name })}
            onClick={onView}
          >
            <Eye aria-hidden />
          </Button>
        )}
        <DownloadButton document={document} />
        {canEdit && (
          <>
            <Button variant="ghost" size="icon" aria-label={t('serviceRecordDocuments.renameLabel', { name: document.name })} onClick={onRename}>
              <Pencil aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" aria-label={t('serviceRecordDocuments.deleteLabel', { name: document.name })} onClick={onDelete}>
              <Trash2 aria-hidden />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * The documents of a service record: name, date and who added each, newest first. Writers add
 * files from the computer or, on a phone, from the gallery and files or straight from the camera.
 * `canEdit` only decides what shows; the API checks the role and that the record is active.
 */
export function ServiceRecordDocuments({ recordId, canEdit }: { recordId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const headingId = useId();
  const query = useQuery(serviceRecordDocumentsQueryOptions(recordId));
  // A camera button only makes sense where the main pointer is a finger.
  const touchScreen = useMediaQuery('(pointer: coarse)');
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<PickedFile[] | null>(null);
  const [viewing, setViewing] = useState<DocumentDto | null>(null);
  const [renaming, setRenaming] = useState<DocumentDto | null>(null);
  const [deleting, setDeleting] = useState<DocumentDto | null>(null);

  const pick = (event: ChangeEvent<HTMLInputElement>, fromCamera: boolean) => {
    const files = [...(event.target.files ?? [])];
    // Clearing the input lets the same file be picked again.
    event.target.value = '';
    if (files.length === 0) return;
    // A camera shot has a name like "image.jpg", which says nothing: start from the day instead.
    const photoName = t('serviceRecordDocuments.photoName', { date: formatDate(today()) });
    setPicked(files.map((file) => ({ file, name: fromCamera ? photoName : defaultDocumentName(file) })));
  };

  const documents = query.data;
  let body: ReactNode;
  if (documents) {
    body =
      documents.length === 0 ? (
        <EmptyState title={t('serviceRecordDocuments.emptyTitle')} hint={t('serviceRecordDocuments.emptyHint')} />
      ) : (
        <ul className="divide-y">
          {documents.map((document) => (
            <DocumentRow
              key={document.id}
              document={document}
              canEdit={canEdit}
              // On a phone the name link opens the file in the browser's own viewer, which pages and zooms better than a frame.
              onView={!touchScreen && previewable(document.contentType) ? () => setViewing(document) : undefined}
              onRename={() => setRenaming(document)}
              onDelete={() => setDeleting(document)}
            />
          ))}
        </ul>
      );
  } else if (query.isError) {
    body = <ErrorState message={problemMessage(query.error)} onRetry={() => void query.refetch()} />;
  } else {
    body = (
      <div role="status" aria-label={t('states.loading')} className="flex flex-col gap-3 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id={headingId} className={sectionTitleClass}>
          {documents ? t('serviceRecordDocuments.count', { count: documents.length }) : t('serviceRecordDocuments.title')}
        </h2>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              <Upload aria-hidden />
              {t('serviceRecordDocuments.upload')}
            </Button>
            {touchScreen && (
              <Button size="sm" variant="outline" onClick={() => cameraInput.current?.click()}>
                <Camera aria-hidden />
                {t('serviceRecordDocuments.takePhoto')}
              </Button>
            )}
            <input ref={fileInput} data-slot="document-file-input" type="file" multiple hidden accept={documentAccept} onChange={(event) => pick(event, false)} />
            <input ref={cameraInput} data-slot="document-camera-input" type="file" hidden accept={imageAccept} capture="environment" onChange={(event) => pick(event, true)} />
          </div>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">{body}</div>

      {picked && <DocumentUploadDialog recordId={recordId} picked={picked} onClose={() => setPicked(null)} />}
      {viewing && <DocumentViewer document={viewing} onClose={() => setViewing(null)} />}
      {renaming && <RenameDialog recordId={recordId} document={renaming} onClose={() => setRenaming(null)} />}
      {deleting && <DeleteDialog recordId={recordId} document={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
}
