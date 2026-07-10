import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { ThemeProvider } from '@/lib/theme-provider'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db'
import { Layout } from '@/components/Layout'
import { Onboarding } from '@/pages/Onboarding'
import { Today } from '@/pages/Today'
import { Add } from '@/pages/Add'
import { Capture } from '@/pages/Capture'
import { Profile } from '@/pages/Profile'
import { Skeleton } from '@/components/ui/Skeleton'
import { UpdatePrompt } from '@/components/UpdatePrompt'

// Schwere, nicht-kritische Routen lazy laden (Code-Splitting): Kernflows
// Heute/Erfassen/Capture bleiben im Haupt-Chunk, damit sie sofort da sind.
const Barcode = lazy(() => import('@/pages/Barcode').then((m) => ({ default: m.Barcode })))
const Week = lazy(() => import('@/pages/Week').then((m) => ({ default: m.Week })))
const Pantry = lazy(() => import('@/pages/Pantry').then((m) => ({ default: m.Pantry })))
const Review = lazy(() => import('@/pages/Review').then((m) => ({ default: m.Review })))
const Coach = lazy(() => import('@/pages/Coach').then((m) => ({ default: m.Coach })))
const Awards = lazy(() => import('@/pages/Awards').then((m) => ({ default: m.Awards })))
const Trends = lazy(() => import('@/pages/Trends').then((m) => ({ default: m.Trends })))

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 pt-10">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-44 w-full" />
    </div>
  )
}

/** Lazy-Route mit Skeleton-Fallback, solange der Chunk lädt. */
function lazyPage(node: ReactNode) {
  return <Suspense fallback={<PageSkeleton />}>{node}</Suspense>
}

/** Zeigt das Onboarding, solange noch kein Profil existiert; sonst die App-Shell. */
function RootGate() {
  // Wichtig: get() liefert undefined sowohl beim Laden als auch bei "nicht
  // gefunden". Wir mappen "nicht gefunden" auf null, um beides zu unterscheiden.
  const profile = useLiveQuery(async () => (await db.profile.get('me')) ?? null, [])

  if (profile === undefined) {
    return <PageSkeleton />
  }
  if (!profile) {
    return (
      <div className="mx-auto max-w-md px-4 pt-8">
        <Onboarding onDone={() => undefined} />
      </div>
    )
  }
  return <Layout />
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootGate />,
    children: [
      { index: true, element: <Today /> },
      { path: 'week', element: lazyPage(<Week />) },
      { path: 'pantry', element: lazyPage(<Pantry />) },
      { path: 'add', element: <Add /> },
      { path: 'capture', element: <Capture /> },
      { path: 'barcode', element: lazyPage(<Barcode />) },
      { path: 'review', element: lazyPage(<Review />) },
      { path: 'coach', element: lazyPage(<Coach />) },
      { path: 'awards', element: lazyPage(<Awards />) },
      { path: 'trends', element: lazyPage(<Trends />) },
      { path: 'profile', element: <Profile onReset={() => undefined} /> },
    ],
  },
])

export function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
      <UpdatePrompt />
    </ThemeProvider>
  )
}
