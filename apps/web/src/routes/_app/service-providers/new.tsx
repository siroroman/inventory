import { createFileRoute } from '@tanstack/react-router';
import { NewServiceProvider } from '@/features/service-providers/provider-form-screen';

export const Route = createFileRoute('/_app/service-providers/new')({ component: NewServiceProvider });
