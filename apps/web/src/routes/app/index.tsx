import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

export const Route = createFileRoute('/app/')({
  component: AppHome,
})

function AppHome() {
  const { session } = Route.useRouteContext()
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome, {session.user.name}</h1>
      <p className="mt-2 text-muted-foreground">Projects will appear here.</p>
      <Button
        variant="outline"
        className="mt-6"
        onClick={async () => {
          await authClient.signOut()
          window.location.href = '/login'
        }}
      >
        Sign out
      </Button>
    </div>
  )
}
