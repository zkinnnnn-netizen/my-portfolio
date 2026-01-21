import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
 
export function middleware(request: NextRequest) {
  const session = request.cookies.get('session')
  const { pathname } = request.nextUrl

  // Protected routes
  const protectedRoutes = ['/inbox', '/sources', '/items', '/audits']
  const isProtected = protectedRoutes.some(route => pathname.startsWith(route))
  
  // API protected routes (except auth)
  const isApiProtected = pathname.startsWith('/api') && !pathname.startsWith('/api/auth') && !pathname.startsWith('/api/ingest') // Ingest might be public for cron? No, cron needs token.
  // Wait, User said: "/api/ingest 触发抓取所有 active sources". 
  // User also said for Cron: "Header x-intake-token".
  // So /api/ingest should be accessible if token is present OR if session is present.
  
  if (isProtected) {
    if (!session) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  // Allow /api/ingest if token matches, otherwise check session
  if (pathname.startsWith('/api/ingest')) {
    const token = request.headers.get('x-intake-token')
    const intakeToken = process.env.INTAKE_TOKEN
    if (token === intakeToken) {
      return NextResponse.next()
    }
    // If no token, check session
    if (!session) {
      return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }
  }

  // Other API routes
  if (pathname.startsWith('/api') && !pathname.startsWith('/api/auth') && !pathname.startsWith('/api/ingest')) {
     if (!session) {
      return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }
  }

  return NextResponse.next()
}
 
export const config = {
  matcher: [
    '/inbox/:path*',
    '/sources/:path*',
    '/items/:path*',
    '/api/:path*',
  ],
}
