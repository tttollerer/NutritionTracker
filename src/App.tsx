import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { ThemeProvider } from '@/lib/theme-provider'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db'
import { Layout } from '@/components/Layout'
import { Onboarding } from '@/pages/Onboarding'
import { Today } from '@/pages/Today'
import { Add } from '@/pages/Add'
import { Capture } from '@/pages/Capture'
import { Barcode } from '@/pages/Barcode'
import { Review } from '@/pages/Review'
import { Coach } from '@/pages/Coach'
import { Awards } from '@/pages/Awards'
import { Profile } from '@/pages/Profile'
import { Trends } from '@/pages/Trends'
import { Skeleton } from '@/components/ui/Skeleton'

/** Zeigt das Onboarding, solange noch kein Profil existiert; sonst die App-Shell. */
function RootGate() {
  // Wichtig: get() liefert undefined sowohl beim Laden als auch bei "nicht
  // gefunden". Wir mappen "nicht gefunden" auf null, um beides zu unterscheiden.
  const profile = useLiveQuery(async () => (await db.profile.get('me')) ?? null, [])

  if (profile === undefined) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 pt-10">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-44 w-full" />
      </div>
    )
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
      { path: 'add', element: <Add /> },
      { path: 'capture', element: <Capture /> },
      { path: 'barcode', element: <Barcode /> },
      { path: 'review', element: <Review /> },
      { path: 'coach', element: <Coach /> },
      { path: 'awards', element: <Awards /> },
      { path: 'trends', element: <Trends /> },
      { path: 'profile', element: <Profile onReset={() => undefined} /> },
    ],
  },
])

export function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  )
}
