import { ChevronRightIcon, ShieldCheckIcon } from 'lucide-react'
import { CopyButton } from '@/components/settings/copy-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/** Same snippet as docs/webhooks.md. */
export const NODE_VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

const SECRET = process.env.HALYARD_WEBHOOK_SECRET

function verify(secret, header, rawBody, toleranceSeconds = 300) {
  if (!header) return false
  let timestamp
  const signatures = []
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2)
    if (key === 't') timestamp = Number(value)
    if (key === 'v1') signatures.push(value)
  }
  if (!Number.isInteger(timestamp) || signatures.length === 0) return false
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false

  const expected = createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest()
  return signatures.some((signature) => {
    const candidate = Buffer.from(signature, 'hex')
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  })
}

createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf8')
    if (!verify(SECRET, req.headers['x-halyard-signature'], rawBody)) {
      res.writeHead(401).end('invalid signature')
      return
    }
    const event = JSON.parse(rawBody)
    console.log(\`received \${event.type} for \${event.entity.key}\`)
    res.writeHead(204).end()
  })
}).listen(8080)
`

/** What the signature is computed over, as shown to users. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: documentation text, not a template
export const SIGNED_PAYLOAD = '${ts}.${rawBody}'
export const SIGNATURE_FORMULA = `hex(HMAC-SHA256(secret, ${SIGNED_PAYLOAD}))`

const HEADERS = [
  ['Content-Type', 'application/json', 'The body is JSON.'],
  ['User-Agent', 'Halyard-Webhooks/1', 'Identifies Halyard.'],
  ['X-Halyard-Event', 'flag.toggled', 'The event type.'],
  [
    'X-Halyard-Delivery',
    '5d0f7c1e-8a43-…',
    'One delivery of one event to this webhook. Stays the same across retries, so use it to de-duplicate.',
  ],
  ['X-Halyard-Timestamp', '1767225600', 'Unix time in seconds when the request was signed.'],
  [
    'X-Halyard-Signature',
    't=1767225600,v1=6f1c…',
    'Timestamp and HMAC-SHA256 signature. May carry more than one v1 value.',
  ],
] as const

export function HeadersTable() {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Header</TableHead>
            <TableHead>Example</TableHead>
            <TableHead className="hidden md:table-cell">Meaning</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {HEADERS.map(([name, example, meaning]) => (
            <TableRow key={name}>
              <TableCell className="font-mono text-xs">{name}</TableCell>
              <TableCell
                className="max-w-48 truncate font-mono text-muted-foreground text-xs"
                title={example}
              >
                {example}
              </TableCell>
              <TableCell className="hidden whitespace-normal text-muted-foreground text-sm md:table-cell">
                {meaning}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function VerifySnippet() {
  return (
    <div className="relative">
      <div className="absolute top-2 right-2">
        <CopyButton value={NODE_VERIFY_SNIPPET} label="Copy snippet" />
      </div>
      <pre className="max-h-80 overflow-auto rounded-md border bg-muted/50 p-3 pr-14 font-mono text-xs leading-relaxed">
        <code>{NODE_VERIFY_SNIPPET}</code>
      </pre>
    </div>
  )
}

/** Collapsible explanation of the signature scheme, headers and a Node example. */
export function SignatureCard() {
  return (
    <Collapsible asChild>
      <Card>
        <CardHeader>
          <CollapsibleTrigger className="group flex w-full items-start gap-3 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <CardTitle>Verifying signatures</CardTitle>
              <CardDescription>
                Check that a request really comes from Halyard before you trust it.
              </CardDescription>
            </div>
            <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="flex flex-col gap-5 text-sm">
            <div className="flex flex-col gap-2">
              <p>
                Every request carries{' '}
                <code className="font-mono text-xs">
                  X-Halyard-Signature: t=&lt;ts&gt;,v1=&lt;hmac&gt;
                </code>
                . The signature is the hex HMAC-SHA256, keyed with the webhook secret, of{' '}
                <code className="font-mono text-xs">{SIGNED_PAYLOAD}</code>.
              </p>
              <ul className="list-disc pl-5 text-muted-foreground">
                <li>Verify the exact bytes of the body before you parse the JSON.</li>
                <li>
                  Reject requests whose timestamp is more than 5 minutes from your clock, so a
                  captured request cannot be replayed later.
                </li>
                <li>
                  Use <code className="font-mono text-xs">X-Halyard-Delivery</code> to de-duplicate:
                  delivery is at least once and the id stays the same across retries.
                </li>
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">Request headers</h3>
              <HeadersTable />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">Node.js example</h3>
              <VerifySnippet />
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
