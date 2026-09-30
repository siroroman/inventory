import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { NewLocation } from '@/features/locations/location-form-screen';

// `?parentId=` starts a sub-location under that location; anything that is not an id is ignored.
const searchSchema = z.object({ parentId: z.uuid().optional().catch(undefined) });

export const Route = createFileRoute('/_app/locations/new')({ validateSearch: searchSchema, component: NewLocationRoute });

function NewLocationRoute() {
  const { parentId } = Route.useSearch();
  return <NewLocation key={parentId} parentId={parentId} />;
}
