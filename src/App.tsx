import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db'
import { Layout } from '@/components/Layout'
import { Onboarding } from '@/pages/Onboarding'
import { Today } from '@/pages/Today'
import { Add } from '@/pages/Add'
import { Coach } from '@/pages/Coach'
import { Awards } from '@/pages/Awards'
import { Profile } from '@/pages/Profile'
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
      { path: 'coach', element: <Coach /> },
      { path: 'awards', element: <Awards /> },
      { path: 'profile', element: <Profile onReset={() => undefined} /> },
    ],
  },
])

export function App() {
  return <RouterProvider router={router} />
}
