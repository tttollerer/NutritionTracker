import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { Today } from '@/pages/Today'
import { Add } from '@/pages/Add'
import { Coach } from '@/pages/Coach'
import { Awards } from '@/pages/Awards'
import { Profile } from '@/pages/Profile'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Today /> },
      { path: 'add', element: <Add /> },
      { path: 'coach', element: <Coach /> },
      { path: 'awards', element: <Awards /> },
      { path: 'profile', element: <Profile /> },
    ],
  },
])

export function App() {
  return <RouterProvider router={router} />
}
