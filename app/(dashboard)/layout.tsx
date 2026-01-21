import Link from 'next/link';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-64 bg-white border-r flex-shrink-0">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold text-gray-800">Media Radar</h1>
        </div>
        <nav className="mt-6 px-4 space-y-2">
          <Link href="/inbox" className="block px-4 py-2 text-gray-700 rounded hover:bg-gray-100 hover:text-blue-600 transition-colors">
            收件箱 (Inbox)
          </Link>
          <Link href="/sources" className="block px-4 py-2 text-gray-700 rounded hover:bg-gray-100 hover:text-blue-600 transition-colors">
            数据源 (Sources)
          </Link>
          <Link href="/audits" className="block px-4 py-2 text-gray-700 rounded hover:bg-gray-100 hover:text-blue-600 transition-colors">
            审核记录
          </Link>
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  );
}
